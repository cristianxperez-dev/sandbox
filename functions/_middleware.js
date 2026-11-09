/* Runs in front of every request to the Cloudflare Pages site (site/_routes.json includes "/*").
   Apps listed in access-gate/apps.js need their own access code; every other request goes straight
   through unchanged. Details: access-gate/README.md. */
import { createGate } from "../access-gate/app-gate.js";
import { PROTECTED_APPS } from "../access-gate/apps.js";

export const onRequest = createGate(PROTECTED_APPS);
