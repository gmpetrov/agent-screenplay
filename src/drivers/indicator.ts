import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pill shown at the top of the screen while Screenplay drives the computer: it says that
 * Screenplay is recording (or rehearsing, during a check) and has a Stop button. It is left
 * out of the capture, so it never appears in the video. macOS and Windows; Linux shows none.
 * SCREENPLAY_INDICATOR=0 turns it off.
 */
export interface Indicator {
  close(): void;
}

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "indicator");
/** The exit code of the pill's Stop button. */
export const STOP_CODE = 3;

export function indicatorCommand(label: string, platform = process.platform): [string, string[]] | undefined {
  if (platform === "darwin") return ["osascript", ["-l", "JavaScript", path.join(ASSETS, "macos.js"), label, String(process.pid)]];
  if (platform === "win32")
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ASSETS, "windows.ps1"), label, String(process.pid)]];
  return undefined;
}

/** Shows the pill; `onStop` runs when the person presses Stop. Never throws: a recording goes on without it. */
export function showIndicator(label: string, onStop: () => void): Indicator {
  const cmd = process.env.SCREENPLAY_INDICATOR === "0" ? undefined : indicatorCommand(label);
  if (!cmd) return { close() {} };
  let child: ChildProcess | undefined;
  try {
    child = spawn(cmd[0], cmd[1], { stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.on("exit", (code) => {
      child = undefined;
      if (code === STOP_CODE) onStop();
    });
  } catch {
    child = undefined;
  }
  return {
    close() {
      child?.kill();
      child = undefined;
    },
  };
}
