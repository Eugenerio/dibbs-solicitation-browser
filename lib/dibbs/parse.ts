// Pure HTML -> data parsing for DIBBS pages (no network). DIBBS is classic ASP.NET WebForms: the RFQ list is a GridView.
import * as cheerio from "cheerio";
import type { Rfq, SetAsideKey } from "../rfq/types";

export const BASE = "https://www.dibbs.bsm.dla.mil";
export const GRID_ID = "ctl00$cph1$grdRfqSearch"; // __EVENTTARGET for postback paging

const toIso = (mdy: string) => {
  const [m, d, y] = mdy.trim().split("-");
  return `${y}-${m}-${d}`;
};

/** DIBBS shows set-aside as an icon; the <img alt> carries the meaning. */
export function setAsideFromAlt(alt: string): SetAsideKey {
  const a = alt.toLowerCase();
  if (a.includes("economically")) return "edwosb";
  if (a.includes("wom")) return "wosb";
  if (a.includes("service") || a.includes("veteran")) return "sdvosb";
  if (a.includes("hubzone")) return "hubzone";
  if (a.includes("combined")) return "combined";
  if (a.includes("unrestricted") || a.includes("not set")) return "unrestricted";
  if (a.includes("small business") || a.includes("set aside") || a.includes("set-aside")) return "small_business";
  return "other";
}

export interface ListingPage {
  rows: Rfq[];
  hidden: Record<string, string>; // ASP.NET state to echo back on the next postback
  maxPagerArg: number; // highest numeric Page$N offered by the pager (0 if none)
}

export function parseListing(html: string): ListingPage {
  const $ = cheerio.load(html);
  const rows: Rfq[] = [];
  const scrapedAtGuard = true; // (timestamps are stamped on the snapshot, not per row)
  void scrapedAtGuard;

  $("#ctl00_cph1_grdRfqSearch tr.BgWhite, #ctl00_cph1_grdRfqSearch tr.BgSilver").each((_, tr) => {
    const row = $(tr);
    const cell = (suffix: string) => row.find(`span[id$="${suffix}"]`).first();

    const nsnLink = cell("lblNsn").find("a").first();
    const nsnDisplay = nsnLink.text().trim();
    if (!nsnDisplay) return;
    const isNsn = /^\d{4}-\d{2}-\d{3}-\d{4}$/.test(nsnDisplay);
    const digits = nsnDisplay.replace(/\D/g, "");

    const sol = cell("lblSolicitation");
    const pdf = sol.find('a[title="RFQ document"]').first();
    const pkg = sol.find('a[title="Package View"]').first();
    const solNumber = pdf.text().trim() || sol.find("a").first().text().trim();
    if (!solNumber) return;

    const icons = sol.find("img").toArray().map((i) => $(i).attr("alt") ?? "");
    const fastAward = icons.some((a) => /fast award/i.test(a));
    const asideAlts = icons.filter((a) => a && !/fast award/i.test(a));
    const keys = Array.from(new Set(asideAlts.map(setAsideFromAlt)));
    const setAside: SetAsideKey = keys.length === 0 ? "other" : keys.length === 1 ? keys[0] : "combined";

    const prHtml = cell("lblPr").html() ?? "";
    const prParts = prHtml.split(/<br\s*\/?>/i).map((s) => cheerio.load(`<i>${s}</i>`)("i").text().trim());
    const qtyMatch = prParts.join(" ").match(/QTY:\s*([\d,]+)/i);

    const techDocs = cell("lblTechnicalDocuments").text().trim();
    const statusCell = cell("lblStatus");
    const quote = statusCell.find('a[href*="QuoteFrm"]').first().attr("href") ?? null;

    rows.push({
      solNumber,
      nsn: isNsn ? digits : nsnDisplay,
      nsnDisplay,
      fsg: isNsn ? digits.slice(0, 2) : null,
      fsc: isNsn ? digits.slice(0, 4) : null,
      nomenclature: cell("lblNomenclature").text().trim(),
      quantity: qtyMatch ? Number.parseInt(qtyMatch[1].replace(/,/g, ""), 10) : null,
      prNumber: prParts[0] ?? "",
      issuedDate: toIso(cell("lblIssued").text()),
      returnByDate: toIso(cell("lblReturnBy").text()),
      status: statusCell.children("span").first().text().trim() || "Open",
      setAside,
      setAsideLabel: asideAlts.join(" + ") || "Unknown",
      fastAward,
      hasTechDocs: techDocs !== "" && techDocs.toLowerCase() !== "none",
      techDocs,
      rfqPdfUrl: pdf.attr("href") ?? null,
      packageUrl: pkg.attr("href") ?? `${BASE}/rfq/rfqrec.aspx?sn=${solNumber.replace(/-/g, "")}`,
      nsnUrl: nsnLink.attr("href") ?? null,
      quoteUrl: quote,
    });
  });

  const hidden: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (name) hidden[name] = $(el).attr("value") ?? "";
  });

  let maxPagerArg = 0;
  $("tr.pagination a[href]").each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/Page\$(\d+)/);
    if (m) maxPagerArg = Math.max(maxPagerArg, Number.parseInt(m[1], 10));
  });

  return { rows, hidden, maxPagerArg };
}

/** Issue dates DIBBS has RFQs for, newest first (ISO). */
export function parseIssueDates(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/RfqRecs\.aspx\?category=issue&TypeSrch=dt&Value=(\d{2}-\d{2}-\d{4})/i);
    if (m) out.push(toIso(m[1]));
  });
  return Array.from(new Set(out)).sort().reverse();
}

export function parseConsentForm(html: string): { action: string; fields: Record<string, string> } | null {
  const $ = cheerio.load(html);
  const form = $("form#FrmBody");
  if (!form.length) return null;
  const fields: Record<string, string> = {};
  form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = $(el).attr("value") ?? "";
  });
  fields["butAgree"] = "OK";
  return { action: form.attr("action") ?? "", fields };
}
