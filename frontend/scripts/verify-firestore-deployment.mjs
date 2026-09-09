// Read-only comparison of deployed Firestore rules/indexes with this repository.
import { readFileSync } from "node:fs";
import { cert } from "firebase-admin/app";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase Admin environment is incomplete");

const credential = cert({ projectId, clientEmail, privateKey });
const accessToken = (await credential.getAccessToken()).access_token;
const headers = { Authorization: `Bearer ${accessToken}` };
const normalize = (value) => value.replace(/\r\n/g, "\n").trim();

const releaseResponse = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`, { headers });
if (!releaseResponse.ok) throw new Error(`Firestore release lookup failed (${releaseResponse.status})`);
const release = await releaseResponse.json();
const rulesResponse = await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers });
if (!rulesResponse.ok) throw new Error(`Firestore ruleset lookup failed (${rulesResponse.status})`);
const deployedRules = await rulesResponse.json();
const localRules = normalize(readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"));
const rulesMatch = deployedRules.source?.files?.some((file) => normalize(file.content ?? "") === localRules);
console.log(`${rulesMatch ? "PASS" : "FAIL"} deployed Firestore rules match repository`);

const expected = JSON.parse(readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8")).indexes;
const deployedByGroup = new Map();
for (const group of new Set(expected.map((index) => index.collectionGroup))) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${encodeURIComponent(group)}/indexes`, { headers });
  if (!response.ok) throw new Error(`Firestore index lookup failed for ${group} (${response.status})`);
  deployedByGroup.set(group, (await response.json()).indexes ?? []);
}
const indexesMatch = expected.every((wanted) => (deployedByGroup.get(wanted.collectionGroup) ?? []).some((actual) => {
  if (actual.queryScope !== wanted.queryScope || actual.state !== "READY") return false;
  return wanted.fields.every((field, index) => {
    const deployed = actual.fields?.[index];
    return deployed?.fieldPath === field.fieldPath && deployed?.order === field.order;
  });
}));
console.log(`${indexesMatch ? "PASS" : "FAIL"} deployed Firestore indexes match repository and are READY`);

if (!rulesMatch || !indexesMatch) process.exit(1);
