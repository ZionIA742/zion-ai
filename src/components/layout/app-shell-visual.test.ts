import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sidebar = readFileSync(
  join(__dirname, "Sidebar.tsx"),
  "utf8",
);

const header = readFileSync(
  join(__dirname, "AppHeader.tsx"),
  "utf8",
);

const shell = readFileSync(
  join(__dirname, "../../app/(app)/AppShellClient.tsx"),
  "utf8",
);

assert.equal(
  sidebar.includes("collapsed: boolean") &&
    sidebar.includes("onToggle: () => void"),
  true,
  "sidebar must expose controlled collapse state",
);

assert.equal(
  sidebar.includes("Abrir menu lateral") &&
    sidebar.includes("Recolher menu lateral"),
  true,
  "sidebar must keep an accessible reopen control",
);

assert.equal(
  sidebar.includes('src="/zion-mark.png"'),
  true,
  "sidebar must render the approved ZION mark asset",
);

assert.equal(
  sidebar.includes("left-full top-1/2") &&
    sidebar.includes("h-14 w-6") &&
    sidebar.includes("-translate-y-1/2") &&
    sidebar.includes("border-l-0"),
  true,
  "sidebar toggle must be a centered narrow handle attached to the right border",
);

assert.equal(
  sidebar.includes('icon: "dashboard"') &&
    sidebar.includes('icon: "settings"') &&
    sidebar.includes("<NavIcon"),
  true,
  "sidebar navigation must render visual icons without an external icon package",
);

assert.equal(
  sidebar.includes(
    "bg-gray-100 text-gray-950 shadow-sm ring-1 ring-black/5",
  ),
  true,
  "active navigation must use the neutral card treatment",
);

assert.equal(
  sidebar.includes("underline underline-offset"),
  false,
  "legacy underline navigation treatment must be removed",
);

assert.equal(
  header.includes("Painel operacional") &&
    header.includes("Loja atual") &&
    header.includes("<StoreIcon"),
  true,
  "header must expose the new contextual hierarchy and store selector",
);

assert.equal(
  /(?:bg|text|border)-(?:blue|sky|cyan)-/.test(
    `${sidebar}\n${header}`,
  ),
  false,
  "shell refresh must remain neutral and must not introduce blue UI accents",
);

assert.equal(
  shell.includes('"zion_sidebar_collapsed"') &&
    shell.includes("localStorage.setItem"),
  true,
  "sidebar collapse preference must persist locally",
);

assert.equal(
  shell.includes("collapsed={isSidebarCollapsed}") &&
    shell.includes("onToggle={handleSidebarToggle}"),
  true,
  "app shell must wire the controlled sidebar",
);

assert.equal(
  shell.includes("flex min-w-0 flex-1 flex-col"),
  true,
  "content area must safely expand when the sidebar collapses",
);

console.log(
  "ok - neutral collapsible app shell visual contract",
);