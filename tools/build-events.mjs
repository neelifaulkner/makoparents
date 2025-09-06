// tools/build-events.mjs
import fs from "node:fs/promises";
import fetch from "node-fetch";
import ical from "ical";

const SOURCES = [
  // Orange Beach City Schools (School)
  { url: "https://www.orangebeachboe.org/cf_calendar/feed.cfm?type=ical&feedID=6BA01E61A3DB4B68B54260AA97151E8F", cats: ["school"], name: "School District" },

  // City calendars (CivicPlus)
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=23", cats: ["arts"], name: "Art Center" },
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=34", cats: ["community","sports"], name: "Parks & Rec" },
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=33", cats: ["arts"], name: "Performing Arts Center" },
];

// Fetch as a normal browser to avoid bot blocking
async function getICS(url){
  const res = await fetch(url, {
    timeout: 30000,
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/calendar, text/plain, */*",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${url}: ${res.status} ${res.statusText}`);
  return await res.text();
}

// Detect all-day (midnight-to-midnight or VALUE=DATE)
function isAllDay(ev){
  // ical parses DATE-only as JS Date at midnight; we also check end if present
  const s = ev.start instanceof Date ? ev.start : null;
  const e = ev.end   instanceof Date ? ev.end   : null;
  if (!s) return false;
  const sMid = s.getHours?.() === 0 && s.getMinutes?.() === 0 && s.getSeconds?.() === 0;
  const eMid = e && e.getHours?.() === 0 && e.getMinutes?.() === 0 && e.getSeconds?.() === 0;
  return sMid && (e ? eMid : true);
}

function normalize(icstext, cats){
  const data = ical.parseICS(icstext);
  const out = [];
  for (const k in data){
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;

    const startISO = ev.start instanceof Date ? ev.start.toISOString() : String(ev.start);
    const endISO   = ev.end   instanceof Date ? ev.end.toISOString()   : (ev.end ? String(ev.end) : "");

    out.push({
      title: ev.summary || "Untitled event",
      start: startISO,
      end: endISO,
      allDay: isAllDay(ev),
      categories: cats,
      location: ev.location || "",
      link: ev.url || "",
      notes: ev.description || ""
    });
  }
  return out;
}

async function main(){
  const all = [];
  for (const src of SOURCES){
    try {
      const ics = await getICS(src.url);
      const items = normalize(ics, src.cats);
      console.log(`[ok] ${src.name}: ${items.length} events`);
      all.push(...items);
    } catch (e){
      console.error(`[ERR] ${src.name}: ${e.message}`);
    }
  }

  // Broaden window: past 365 days → next 730 days
  const now = new Date();
  const pastCutoff = new Date(now); pastCutoff.setDate(pastCutoff.getDate() - 365);
  const futureCutoff = new Date(now); futureCutoff.setDate(futureCutoff.getDate() + 730);

  const windowed = all.filter(ev => {
    const d = new Date(ev.start);
    return !isNaN(d) && d >= pastCutoff && d <= futureCutoff;
  });

  windowed.sort((a,b) => new Date(a.start) - new Date(b.start));

  await fs.mkdir("calendar", { recursive: true });
  await fs.writeFile("calendar/events.json", JSON.stringify(windowed, null, 2));

  // Simple category counts for debugging
  const counts = windowed.reduce((acc, ev) => {
    (ev.categories || []).forEach(c => acc[c] = (acc[c] || 0) + 1);
    return acc;
  }, {});
  console.log(`Wrote ${windowed.length} events to calendar/events.json`);
  console.log("Category counts:", counts);
}

main().catch(err => { console.error(err); process.exit(1); });
