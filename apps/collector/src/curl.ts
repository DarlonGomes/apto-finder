// Shared curl-based HTTP: Node/undici's TLS fingerprint gets 403'd by these
// portals' CDNs; curl with browser headers passes (Glue spike finding).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function curlJson(
  url: string,
  headerArgs: string[],
): Promise<{ status: number; json: any }> {
  const { stdout } = await exec(
    "curl",
    ["-s", "--max-time", "60", "-w", "\n%{http_code}", "--http2", ...headerArgs, url],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const nl = stdout.lastIndexOf("\n");
  let json: any = null;
  try {
    json = JSON.parse(stdout.slice(0, nl));
  } catch {
    /* error bodies can be HTML */
  }
  return { status: Number(stdout.slice(nl + 1)), json };
}
