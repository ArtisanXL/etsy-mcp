import { readFileSync, writeFileSync } from "node:fs";
import { downloadSpec } from "./download-spec.js";

const target = new URL("../spec/etsy-openapi.json", import.meta.url);
const next = await downloadSpec(fetch);
const current = readFileSync(target, "utf8");
if (next === current) {
  console.log("Spec Snapshot already up to date");
} else {
  writeFileSync(target, next);
  console.log("Spec Snapshot updated");
}
