# Publishing checklist — before this repo goes public

The working tree is publish-safe: personal data is gitignored and untracked.
**Git history is not.** Early commits contain machine paths, usernames, and
real security-audit reports; making THIS repo public exposes every past
commit. Do the release from a clean copy instead:

1. **Fresh history.** From the repo root:

   ```
   git checkout --orphan public-release
   git add -A
   # Drop local-only agent config so it never reaches the public copy.
   # (.claude/ holds your permission profile incl. bypassPermissions;
   #  CLAUDE.md + PLUTUS.md are your private Plutus wiring; the lockfile is
   #  empty noise for a zero-dependency project.)
   git rm --cached -r --ignore-unmatch .claude CLAUDE.md PLUTUS.md package-lock.json
   git commit -m "ICM Protocols — initial public release"
   ```

   Push that single-commit branch to a NEW public repository (or
   `git push public public-release:main`). Never flip the private repo
   public.

2. **Pre-push scan.** On the release branch, confirm all of these return
   nothing:

   ```
   git grep -iI "<your-os-username>"
   git grep -iI "<your-account-handles>"
   git ls-files | grep -iE "\.env($|\.)|secrets-lock|security-reports|app-config\.json"
   git ls-files | grep -iE "^\.claude/|^CLAUDE\.md$|^PLUTUS\.md$|^package-lock\.json$"
   ```

3. **Sanity boot.** Clone the release somewhere else (or temporarily rename
   `data/app-config.json`) and run `node server.js` — it must start with
   home-dir defaults and show empty states, not crash.

4. **Keep the split forever.** Day-to-day work stays in the private repo;
   publish by repeating step 1 onto the public remote when you want to ship
   an update. Your reports, registry, and machine config never sync because
   they are gitignored.

5. **Positioning.** Describe the audit feature as an opinionated personal
   security-governance tool — not a certification or a guarantee.
