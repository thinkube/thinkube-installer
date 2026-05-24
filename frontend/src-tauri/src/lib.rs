/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

use std::process::{Command, Child};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

// State to hold the backend process
struct BackendProcess(Mutex<Option<Child>>);

#[tauri::command]
fn get_config_flags() -> (bool, bool) {
    let tk_test_raw = std::env::var("TK_TEST").ok();
    let tk_shell_raw = std::env::var("TK_SHELL_CONFIG").ok();

    println!("🔍 DEBUG get_config_flags:");
    println!("  TK_TEST raw value: {:?}", tk_test_raw);
    println!("  TK_SHELL_CONFIG raw value: {:?}", tk_shell_raw);

    let test_mode = tk_test_raw.map(|v| v == "1").unwrap_or(false);
    let shell_config = tk_shell_raw.map(|v| v == "1").unwrap_or(false);

    println!("  test_mode: {}", test_mode);
    println!("  shell_config: {}", shell_config);

    (test_mode, shell_config)
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
        // In dev mode, cargo runs from frontend/src-tauri/, so backend is just ./backend
        backend_dir = std::env::current_dir()
          .unwrap()
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

      // Build the backend spawn command. Both Linux and macOS use the
      // same bash invocation; the cfg-gated branches existed previously
      // but the body was identical, so they're collapsed here.
      //
      // Branch bake-in:
      //   If the build was invoked as `scripts/build.sh --branch <name>`
      //   then THINKUBE_BUILD_BRANCH is set at compile time. We forward
      //   it to the Python backend as THINKUBE_BRANCH so the produced
      //   binary defaults to that branch when launched from the .desktop
      //   menu (where env vars from the user shell don't propagate).
      //   A user who launches from a terminal with THINKUBE_BRANCH set
      //   wins — Command::env only sets the var if we don't see it
      //   already in our own env.
      //
      //   Same shape for THINKUBE_REPO_URL and THINKUBE_METADATA_REPO
      //   so a fork-pinned deb is also buildable.
      let backend_child = {
        let mut cmd = Command::new("bash");
        cmd.arg("-c")
           .arg(format!("cd {} && source {}/bin/activate && python3 main.py",
                        backend_dir.display(), venv_dir));

        // Forward baked-in defaults unless the user has overridden them.
        for (compile_env, runtime_env) in [
          (option_env!("THINKUBE_BUILD_BRANCH"),         "THINKUBE_BRANCH"),
          (option_env!("THINKUBE_BUILD_REPO_URL"),       "THINKUBE_REPO_URL"),
          (option_env!("THINKUBE_BUILD_METADATA_REPO"),  "THINKUBE_METADATA_REPO"),
        ] {
          if let Some(baked) = compile_env {
            if !baked.is_empty() && std::env::var(runtime_env).is_err() {
              cmd.env(runtime_env, baked);
              println!("Baked-in {}: {}", runtime_env, baked);
            }
          }
        }

        cmd.spawn().expect("Failed to start backend")
      };

      // Store the backend process in app state
      app.manage(BackendProcess(Mutex::new(Some(backend_child))));

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

        // Add cleanup handler for backend process when window closes
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { .. } = event {
            println!("Window closing, killing backend process...");
            if let Some(backend_state) = app_handle.try_state::<BackendProcess>() {
              if let Ok(mut child_opt) = backend_state.0.lock() {
                if let Some(mut child) = child_opt.take() {
                  let _ = child.kill();
                  println!("Backend process killed");
                }
              }
            }
          }
        });
      } else {
        println!("WARNING: Main window not found!");
      }

      println!("Tauri setup complete");
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
