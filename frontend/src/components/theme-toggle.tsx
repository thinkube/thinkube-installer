import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

import { TkButton } from "thinkube-style/components/buttons-badges";

export function ThemeToggle() {
  const { theme, setTheme, actualTheme } = useTheme();

  const handleToggle = () => {
    const newTheme = actualTheme === "dark" ? "light" : "dark";
    console.log('Toggling theme from', actualTheme, 'to', newTheme);
    setTheme(newTheme);
  };

  return (
    <TkButton
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      className="w-9 h-9"
    >
      {actualTheme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </TkButton>
  );
}
