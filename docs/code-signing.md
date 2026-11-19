# Code signing

The installers are unsigned until certificates are bought. Without a signature:

- **macOS** shows "Ósemka cannot be opened because the developer cannot be verified". The student has to right-click the app, choose **Open**, then **Open** again. This is needed only the first time.
- **Windows** SmartScreen shows "Windows protected your PC". The student has to click **More info → Run anyway**.

Signing removes these warnings. The packaging config (`apps/desktop/electron-builder.config.cjs`) signs on its own when the certificates are present as environment variables. Nothing in the code changes. The same `pnpm dist:mac` / `pnpm dist:win` commands, and the CI `package` job, then produce signed installers.

## macOS: Developer ID and notarisation

1. **Join the Apple Developer Program.** It costs 99 USD a year and can be an individual or an organisation account.
2. **Create a Developer ID Application certificate.** Use Xcode → Settings → Accounts → Manage Certificates, or developer.apple.com. Export it from Keychain Access as a `.p12` file with a password.
3. **Create an app-specific password** for the Apple ID, at account.apple.com → Sign-In and Security.
4. **Set these variables** (as GitHub repository secrets for CI, or in your shell for a local build):

| Variable | Value |
|---|---|
| `CSC_LINK` (CI secret `MAC_CSC_LINK`) | The `.p12` file as base64 (`base64 -i cert.p12 \| pbcopy`), or a file path when building locally |
| `CSC_KEY_PASSWORD` (CI secret `MAC_CSC_KEY_PASSWORD`) | The `.p12` password |
| `APPLE_ID` | The Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password |
| `APPLE_TEAM_ID` | The 10-character team ID |

With a certificate, the build turns on the hardened runtime with `build/entitlements.mac.plist` (JIT only). It replaces the ad-hoc signature with the Developer ID one and sends the app to Apple for notarisation, which usually takes a few minutes. Check the result with:

```bash
spctl -a -vv -t install apps/desktop/release/mac-arm64/Osemka.app
```

## Windows

Choose one of these:

- **Azure Trusted Signing** (Microsoft Artifact Signing) costs about 10 USD a month and is the cheapest route. SmartScreen trusts it from the start. It needs an identity validation of the person or company. Create a Trusted Signing account and a certificate profile, and an app registration (service principal) with the "Trusted Signing Certificate Profile Signer" role. Then set:
  - **GitHub secrets:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
  - **GitHub variables (not secret):** `OSEMKA_AZURE_ENDPOINT` (e.g. `https://weu.codesigning.azure.net/`), `OSEMKA_AZURE_ACCOUNT`, `OSEMKA_AZURE_PROFILE`, `OSEMKA_AZURE_PUBLISHER` (the certificate's subject CN)

  The Azure signing tool runs on Windows, so sign in the CI `package-windows-latest` job, not with `dist:win:mac` on a Mac.

- **A code-signing certificate from a CA** (OV or EV) costs roughly 200–500 USD a year. Since 2023 these come on a hardware token or in a cloud HSM. If you get a `.pfx`, set `WIN_CSC_LINK` (base64 or path) and `WIN_CSC_KEY_PASSWORD`. A cloud HSM needs the vendor's signing tool instead; see the electron-builder docs ("Code Signing → Windows").

## After signing

- Build a test installer and run the packaged smoke check:

  ```bash
  OSEMKA_SMOKE_EXE=release/mac-arm64/Osemka.app/Contents/MacOS/Osemka pnpm --filter @osemka/desktop smoke:packaged
  ```

  The fuse `enableEmbeddedAsarIntegrityValidation` checks `app.asar` against the signed binary. If something is modified after signing, the app refuses to start.
- Never commit certificates, `.p12`/`.pfx` files or passwords. Keep them only in GitHub secrets or your keychain.
