// Packaging (electron-builder). Signing switches itself on when the certificates are provided as environment
// variables (CI secrets or a local shell), so the same command builds unsigned test installers and signed releases.
// See docs/code-signing.md for what to buy and which variables to set.
//
// macOS, Developer ID + notarisation:  CSC_LINK (.p12, base64 or path), CSC_KEY_PASSWORD,
//   and for notarisation APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   (or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER).
// Windows, either a certificate file: WIN_CSC_LINK (.pfx) + WIN_CSC_KEY_PASSWORD,
//   or Azure Trusted Signing: AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET and
//   OSEMKA_AZURE_ENDPOINT + OSEMKA_AZURE_ACCOUNT + OSEMKA_AZURE_PROFILE + OSEMKA_AZURE_PUBLISHER.
const env = process.env;
const macSigned = !!env.CSC_LINK || !!env.CSC_NAME;
const azure = env.OSEMKA_AZURE_ENDPOINT && env.OSEMKA_AZURE_ACCOUNT && env.OSEMKA_AZURE_PROFILE && env.OSEMKA_AZURE_PUBLISHER;

/** @type {import("electron-builder").Configuration} */
module.exports = {
  // File and bundle names stay ASCII (Electron finds its helper apps by name; "Ó" broke that on macOS);
  // people see "Ósemka" through the display name, the shortcuts and the uninstaller entry.
  appId: "pl.osemka.app",
  productName: "Osemka",
  executableName: "Osemka",
  // better-sqlite3's prebuilds are N-API binaries for every platform, so nothing is recompiled; this also lets
  // the Windows installer be built on a Mac with the recordings, which are not in git.
  npmRebuild: false,
  // Installers are attached by hand or downloaded from CI artifacts; never published automatically.
  publish: null,
  // Electron fuses: switch off what the app does not use (Electron security checklist, "Check which fuses you can change").
  electronFuses: {
    runAsNode: false, // the binary cannot be used as a plain Node.js (ELECTRON_RUN_AS_NODE)
    enableNodeOptionsEnvironmentVariable: false, // NODE_OPTIONS / NODE_EXTRA_CA_CERTS ignored
    enableNodeCliInspectArguments: false, // no --inspect debugger on the installed app
    enableCookieEncryption: true,
    enableEmbeddedAsarIntegrityValidation: true, // app.asar is checked against the hash in the signed binary
    onlyLoadAppFromAsar: true, // …and nothing else can be loaded in its place
    grantFileProtocolExtraPrivileges: false, // the window is served from osemka-app://, file:// gets no extra rights
  },
  directories: { output: "release", buildResources: "build" },
  // Everything but the native SQLite module is bundled by electron-vite into out/. better-sqlite3 ships one
  // prebuilt N-API binary per platform (prebuilds/), which works in Electron as is; each installer keeps only its own.
  files: [
    "out/**",
    "drizzle/**",
    "package.json",
    "!**/node_modules/better-sqlite3/{deps,src,docs,benchmark,build}/**",
    "!**/node_modules/better-sqlite3/prebuilds/{linux,linuxmusl}-*.node",
  ],
  // The published exam sessions (with the English recordings, which are not in git) go next to the app,
  // where the main process reads them (process.resourcesPath/content). Importer working files stay out.
  extraResources: [
    { from: "../../content", to: "content", filter: ["**/*", "!**/review-notes.json", "!**/import-report.json", "!**/.DS_Store"] },
  ],
  asarUnpack: ["**/node_modules/better-sqlite3/**"],
  win: {
    files: ["!**/node_modules/better-sqlite3/prebuilds/{darwin-*,win32-arm64}.node"],
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "Osemka-Setup-${version}.${ext}",
    // A .pfx in WIN_CSC_LINK is picked up by electron-builder itself; Azure Trusted Signing needs its account here.
    ...(azure
      ? {
          azureSignOptions: {
            endpoint: env.OSEMKA_AZURE_ENDPOINT,
            codeSigningAccountName: env.OSEMKA_AZURE_ACCOUNT,
            certificateProfileName: env.OSEMKA_AZURE_PROFILE,
            publisherName: env.OSEMKA_AZURE_PUBLISHER,
          },
        }
      : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false, // per-user install, no administrator rights needed
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Ósemka",
    uninstallDisplayName: "Ósemka",
    deleteAppDataOnUninstall: false,
  },
  mac: {
    files: ["!**/node_modules/better-sqlite3/prebuilds/win32-*.node"],
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    category: "public.app-category.education",
    extendInfo: { CFBundleDisplayName: "Ósemka" },
    artifactName: "Osemka-${version}-${arch}.${ext}",
    ...(macSigned
      ? {
          // Developer ID: the certificate from CSC_LINK, hardened runtime (required for notarisation), and the
          // entitlements Electron needs under it. Notarisation runs when the APPLE_* variables are set.
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: "build/entitlements.mac.plist",
          entitlementsInherit: "build/entitlements.mac.plist",
        }
      : {
          // No certificate: "-" signs the whole app ad hoc (required on Apple silicon); Gatekeeper asks to confirm on
          // first open. The hardened runtime is for notarised builds; with an ad-hoc signature its library validation
          // stops Electron starting.
          identity: "-",
          hardenedRuntime: false,
        }),
  },
  dmg: { title: "Ósemka ${version}" },
};
