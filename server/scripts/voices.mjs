#!/usr/bin/env node
/**
 * List the voices the edge provider can speak, so you can choose one instead of
 * guessing a name.
 *
 * This is a live call to Microsoft's voice list, which is why it is a script and
 * not a test - the suite must never depend on an unofficial endpoint being up.
 * Same reasoning as check-edge.mjs.
 *
 *   npm run voices                 # English voices, male and female
 *   npm run voices -- en-GB        # one locale
 *   npm run voices -- female       # one gender, any English locale
 *   npm run voices -- en-AU male   # both
 *   npm run voices -- all          # every locale the service offers
 *
 * Put a ShortName into a storyboard as `voice.name`, either on the storyboard
 * (every step) or on one step (that step only).
 */
import { MsEdgeTTS } from "msedge-tts";

const args = process.argv.slice(2).map((a) => a.toLowerCase());
const wantAll = args.includes("all");
const gender = args.find((a) => a === "male" || a === "female");
const locale = args.find((a) => /^[a-z]{2}(-[a-z]{2})?$/i.test(a) && a !== "all");

const voices = await new MsEdgeTTS().getVoices();

let rows = voices.filter((v) => (wantAll ? true : (locale ?? "en").split("-")[0] === v.Locale.split("-")[0]));
if (locale?.includes("-")) rows = rows.filter((v) => v.Locale.toLowerCase() === locale);
if (gender) rows = rows.filter((v) => v.Gender.toLowerCase() === gender);

rows.sort((a, b) => a.Locale.localeCompare(b.Locale) || a.Gender.localeCompare(b.Gender) || a.ShortName.localeCompare(b.ShortName));

if (rows.length === 0) {
  console.error(`No voices matched ${args.join(" ") || "(default: English)"}. Try: npm run voices -- all`);
  process.exit(1);
}

let locale_ = "";
for (const v of rows) {
  if (v.Locale !== locale_) {
    locale_ = v.Locale;
    console.log(`\n${v.LocaleName} (${v.Locale})`);
  }
  // FriendlyName is "Microsoft Ava Online (Natural) - English (United States)";
  // the given name is the only part of it a person is choosing between.
  const given = /Microsoft\s+(\S+?)(?:Multilingual)?\s+Online/.exec(v.FriendlyName ?? "")?.[1] ?? "";
  const tags = (v.VoiceTag?.VoicePersonalities ?? []).join(", ");
  console.log(`  ${v.ShortName.padEnd(34)} ${v.Gender.padEnd(7)} ${given.padEnd(14)} ${tags}`);
}

const male = rows.filter((v) => v.Gender === "Male").length;
console.log(`\n${rows.length} voices - ${male} male, ${rows.length - male} female.`);
console.log('Use one as voice.name, e.g. { "provider": "edge", "name": "%s" }.'.replace("%s", rows[0].ShortName));
console.log("A step may carry its own voice, so one walkthrough can use several.");
