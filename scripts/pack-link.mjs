#!/usr/bin/env node
// Turn a brand pack file into a private demo link: node scripts/pack-link.mjs pack.json [base-url]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [file, base = "https://harshadprabhu.github.io/Leksy/"] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/pack-link.mjs pack.json [base-url]");
  process.exit(1);
}
const json = JSON.stringify(JSON.parse(readFileSync(file, "utf8")));
const frag = gzipSync(json, { level: 9 }).toString("base64url");
const url = `${base}#pack=${frag}`;
if (url.length > 60000) console.error(`warning: link is ${url.length} characters; shrink the logos to keep it under ~60,000`);
console.log(url);
