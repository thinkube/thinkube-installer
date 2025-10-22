/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

use std::process::Command;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn get_config_flags() -> (bool, bool) {
    let skip_config = std::env::var("SKIP_CONFIG").is_ok();
    let clean_state = std::env::var("CLEAN_STATE").is_ok();
    (skip_config, clean_state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_config_flags])
    .setup(|app| {
      // Start backend
      println!("Starting FastAPI backend...");

      let backend_dir: PathBuf;
      let venv_dir: String;

      // In development mode, use local backend directory
      #[cfg(debug_assertions)]
      {
        // Backend is now in frontend/src-tauri/backend
        backend_dir = std::env::current_dir()
          .unwrap()
          .join("frontend")
          .join("src-tauri")
          .join("backend");
        venv_dir = "venv-test".to_string();
      }

      // In production mode, use bundled backend from resources
      #[cfg(not(debug_assertions))]
      {
        match app.path().resource_dir() {
          Ok(resource_path) => {
            backend_dir = resource_path.join("backend");
            println!("Resource directory: {}", resource_path.display());
            println!("Backend directory: {}", backend_dir.display());

            if !backend_dir.exists() {
              eprintln!("ERROR: Backend directory not found at: {}", backend_dir.display());
              eprintln!("Resource directory contents:");
              if let Ok(entries) = std::fs::read_dir(&resource_path) {
                for entry in entries.flatten() {
                  eprintln!("  - {}", entry.path().display());
                }
              }
              panic!("Backend directory not found in app bundle");
            }
          }
          Err(e) => {
            eprintln!("ERROR: Failed to get resource directory: {}", e);
            panic!("Cannot access app resources");
          }
        }
        venv_dir = ".venv".to_string();

        // On macOS, check if venv exists and create it if needed (no post-install script support)
        #[cfg(target_os = "macos")]
        {
          let venv_path = backend_dir.join(&venv_dir);
          if !venv_path.exists() {
            println!("First run on macOS: Creating backend virtual environment...");

            // Create venv
            let status = std::process::Command::new("python3")
              .args(&["-m", "venv", venv_path.to_str().unwrap()])
              .status()
              .expect("Failed to create venv");

            if !status.success() {
              panic!("Failed to create Python virtual environment");
            }

            // Install dependencies
            println!("Installing backend dependencies...");
            let pip_path = venv_path.join("bin").join("pip");
            let requirements_path = backend_dir.join("requirements.txt");

            let status = std::process::Command::new(pip_path)
              .args(&["install", "-q", "-r", requirements_path.to_str().unwrap()])
              .status()
              .expect("Failed to install dependencies");

            if !status.success() {
              panic!("Failed to install backend dependencies");
            }

            println!("Backend environment setup complete");
          }
        }
      }

      println!("Backend directory: {}", backend_dir.display());

      // Start backend based on OS
      #[cfg(target_os = "linux")]
      {
        Command::new("bash")
          .arg("-c")
          .arg(format!("cd {} && source {}/bin/activate && python3 main.py",
                       backend_dir.display(), venv_dir))
          .spawn()
          .expect("Failed to start backend");
      }

      #[cfg(target_os = "macos")]
      {
        Command::new("bash")
          .arg("-c")
          .arg(format!("cd {} && source {}/bin/activate && python3 main.py",
                       backend_dir.display(), venv_dir))
          .spawn()
          .expect("Failed to start backend");
      }

      // Give backend time to start
      std::thread::sleep(std::time::Duration::from_secs(3));
      println!("Tauri setup starting...");
      
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      // Get the main window
      if let Some(window) = app.get_webview_window("main") {
        println!("Main window found, showing it...");
        window.show().unwrap();
        window.center().unwrap();
        window.set_focus().unwrap();
        
        // Open devtools in development mode
        #[cfg(debug_assertions)]
        {
          println!("Opening devtools...");
          window.open_devtools();
        }
      } else {
        println!("WARNING: Main window not found!");
      }
      
      println!("Tauri setup complete");
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
