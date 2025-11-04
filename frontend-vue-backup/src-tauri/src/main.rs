/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

fn main() {
  // Set WebKit environment variable BEFORE Tauri/WebKit initializes
  // This fixes white screen issues on NVIDIA GPU systems (DGX Spark, RTX workstations)
  // See: https://bugs.webkit.org/show_bug.cgi?id=254901
  std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

  app_lib::run();
}
