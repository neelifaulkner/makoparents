// tools/build-events.mjs
import fs from "node:fs/promises";
import fetch from "node-fetch";
import ical from "ical";

// Add/adjust feeds + tags here
const SOURCES = [
  // School district
  { url: "https://www.orangebeachboe.org/cf_calendar/feed.cfm?type=ical&feedID=6BA01E61A3DB4B68B54260AA97151E8F", cats: ["school"] },
  // City (CivicPlus) calendars
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=23", cats: ["arts"] },               // Art Center
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=34", cats: ["community","sports"] }, // Parks & Rec
  { url: "https://orangebeachal.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=33", cats: ["arts"] },              // Performing Arts Center
];

async function getICS(url){
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`Fetch failed ${url}: ${res.status}`);
  return await res.text();
}

function isAllDay(ev){
  // crude but effective: all-day events are usually midnight-to-midnight
  const s = ev.start instanceof Date ? ev.start : null;
  const e = ev.end   instanceof Date ? ev.end   : null;
  if (!s) return false;
  const sMid = s.getHours() === 0 && s.getMinutes() === 0;
  const eMid = e && e.getHours() === 0 && e.getMinutes() === 0;
  return sMid && (!!e ? eMid : true);
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
      all.push(...items);
    } catch (e){
      console.error("Source error:", src.url, e.message);
    }
  }

  // Optional: keep a sane window (past 90 days to next 365 days)
  const now = new Date();
  const pastCutoff = new Date(now); pastCutoff.setDate(pastCutoff.getDate() - 90);
  const futureCutoff = new Date(now); futureCutoff.setDate(futureCutoff.getDate() + 365);
  const windowed = all.filter(ev => {
    const d = new Date(ev.start);
    return d >= pastCutoff && d <= futureCutoff;
  });

  windowed.sort((a,b) => new Date(a.start) - new Date(b.start));
  await fs.mkdir("calendar", { recursive: true });
  await fs.writeFile("calendar/events.json", JSON.stringify(windowed, null, 2));
  console.log(`Wrote ${windowed.length} events to calendar/events.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
