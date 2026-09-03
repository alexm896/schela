export const INSTALL_LINES = [
  "git clone https://github.com/imariusalin/schela.git",
  "cd schela",
  "sudo bash install.sh",
] as const;

export const INSTALL_CMD = INSTALL_LINES.join(" && ");
