// Minimal cookie-aware HTTP client for DIBBS: handles the DoD consent interstitial and ASP.NET form posts.
// Uses node:https (not fetch): DIBBS sits behind an F5 WAF that rejects undici's default header set
// (sec-fetch-*, accept-language: *), but accepts a plain browser-like header set.
import https from "node:https";
import zlib from "node:zlib";
import { BASE, parseConsentForm } from "./parse";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const decoder = new TextDecoder("windows-1252"); // DIBBS serves ISO-8859-1
const agent = new https.Agent({ keepAlive: true, maxSockets: 6 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawResponse {
  status: number;
  location: string | null;
  setCookie: string[];
  body: string;
}

function rawRequest(url: string, method: "GET" | "POST", body: string | undefined, cookie: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        agent,
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        timeout: 30_000,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          let buf = Buffer.concat(chunks);
          try {
            const enc = res.headers["content-encoding"];
            if (enc === "gzip") buf = zlib.gunzipSync(buf);
            else if (enc === "deflate") buf = zlib.inflateSync(buf);
          } catch (e) {
            return reject(e);
          }
          resolve({
            status: res.statusCode ?? 0,
            location: (res.headers.location as string | undefined) ?? null,
            setCookie: res.headers["set-cookie"] ?? [],
            body: decoder.decode(buf),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export class DibbsClient {
  private jar = new Map<string, string>();
  private consented = false;

  private cookieHeader() {
    return Array.from(this.jar, ([k, v]) => `${k}=${v}`).join("; ");
  }

  /** One request with manual redirect following (so cookies set on 302s are kept) + retries. */
  private async fetchText(url: string, init: { method?: "GET" | "POST"; body?: string } = {}, attempt = 0): Promise<{ url: string; html: string }> {
    let method = init.method ?? "GET";
    let body = init.body;
    let current = url;
    try {
      for (let hop = 0; hop < 8; hop++) {
        const res = await rawRequest(current, method, body, this.cookieHeader());
        for (const line of res.setCookie) {
          const [pair] = line.split(";");
          const i = pair.indexOf("=");
          if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
        if (res.status >= 300 && res.status < 400 && res.location) {
          current = new URL(res.location, current).toString();
          method = "GET";
          body = undefined;
          continue;
        }
        if (res.status >= 500) throw new Error(`HTTP ${res.status} for ${current}`);
        if (/<title>\s*Request Rejected/i.test(res.body)) throw new Error(`WAF rejected request for ${current}`);
        return { url: current, html: res.body };
      }
      throw new Error(`Too many redirects for ${url}`);
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(800 * 2 ** attempt);
      return this.fetchText(url, init, attempt + 1);
    }
  }

  /** Accept the DoD Warning & Consent banner the way a browser click would. */
  private async consent() {
    const landing = await this.fetchText(`${BASE}/rfq/`);
    if (!/dodwarning\.aspx/i.test(landing.url)) {
      this.consented = true;
      return;
    }
    const form = parseConsentForm(landing.html);
    if (!form) throw new Error("DoD consent page changed: form not found");
    // POST back to the URL the banner was served from (what a browser's form would target).
    await this.fetchText(landing.url, { method: "POST", body: new URLSearchParams(form.fields).toString() });
    this.consented = true;
  }

  /** GET a DIBBS page, consenting first if needed (and again if the session lapses). */
  async get(url: string): Promise<string> {
    if (!this.consented) await this.consent();
    let res = await this.fetchText(url);
    if (/dodwarning\.aspx/i.test(res.url)) {
      await this.consent();
      res = await this.fetchText(url);
      if (/dodwarning\.aspx/i.test(res.url)) throw new Error("Consent was not accepted by DIBBS");
    }
    return res.html;
  }

  async post(url: string, fields: Record<string, string>): Promise<string> {
    const res = await this.fetchText(url, { method: "POST", body: new URLSearchParams(fields).toString() });
    return res.html;
  }
}

export { BASE };
