// SPDX-License-Identifier: GPL-3.0-or-later
const report = await Bun.file(process.argv[2] ?? 'dist/shexli.json').json();
const metadata = await Bun.file(new URL('../metadata.json', import.meta.url)).json();
if (!Array.isArray(report.findings) || typeof report.summary?.finding_count !== 'number')
    throw new Error('Unexpected Shexli report: refusing to accept an unverifiable review');
const exactVersions = JSON.stringify(metadata['shell-version']) === '["49","50","51"]';
const blocking = report.findings.filter(finding => {
    // Shexli 0.2.1 (April 2026 spec) hardcodes major >50 as future.
    // GNOME 51 is stable: https://release.gnome.org/51/ (2026-09-16).
    // Limit this exception to that exact obsolete report; real 49/50/51
    // runtime jobs remain mandatory before release. No new major is waived.
    const staleMajorCheck = report.spec_version === '2026-04-02' &&
        finding.rule_id === 'EGO-M-004' && exactVersions &&
        JSON.stringify(report.artifacts?.target_versions) === '[49,50,51]' &&
        finding.evidence?.length === 1 &&
        finding.evidence[0].snippet === "shell-version=['49', '50', '51']";
    console.log(`${staleMajorCheck ? 'documented stale-major exception' : finding.severity}: ${finding.rule_id} ${finding.message}`);
    return !staleMajorCheck;
});
if (blocking.length !== 0 || report.summary.finding_count !== report.findings.length)
    throw new Error('Shexli findings must be resolved before publication');
console.log(`Shexli ${report.spec_version}: no unresolved findings`);
