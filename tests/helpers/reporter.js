/**
 * Custom Jest Reporter - Generates XML report and sends to production notification
 *
 * Implements Jest Reporter interface:
 * - onRunComplete: called after all tests finish
 * - Generates XML with severity, category, law references
 * - POSTs to /system/test-report on production
 */

const REPORT_API_URL = process.env.REPORT_API_URL || 'https://api.contendo.es';
const TEST_REPORT_API_KEY = process.env.TEST_REPORT_API_KEY;

// Severity mapping based on test file naming convention
const SEVERITY_MAP = {
  'A1-smoke': 'LOW',
  'A2-validation': 'MEDIUM',
  'A3-auth': 'HIGH',
  'A4-multitenancy': 'CRITICAL',
  'A5-concurrency': 'HIGH',
  'A6-uploads': 'MEDIUM',
  'A7-ai-agent': 'MEDIUM',
  'B1-rd8-2019': 'CRITICAL',
  'B2-verifactu': 'CRITICAL',
  'B3-rgpd': 'CRITICAL',
  'B4-pgc': 'HIGH',
  'B5-facturacion': 'HIGH',
  'B6-audit': 'MEDIUM',
  'B7-ai-compliance': 'MEDIUM',
};

const LAW_MAP = {
  'B1-rd8-2019': 'RD 8/2019 - Registro de Jornada',
  'B2-verifactu': 'Ley 11/2021 Antifraude + VeriFactu',
  'B3-rgpd': 'RGPD (Reglamento UE 2016/679) + LOPDGDD',
  'B4-pgc': 'PGC PYMES (RD 1515/2007)',
  'B5-facturacion': 'Ley de Facturacion + RD 1619/2012',
  'B6-audit': 'Ley 11/2021 Antifraude - Trazabilidad',
  'B7-ai-compliance': 'AI Act (EU 2024/1689)',
};

function getCategoryFromPath(testPath) {
  const match = testPath.match(/(A\d|B\d)-[\w-]+/);
  return match ? match[0] : 'unknown';
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateXml(results, startTime) {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const date = new Date().toISOString();

  let totalPassed = 0;
  let totalFailed = 0;
  const runtimePassed = { passed: 0, failed: 0 };
  const compliancePassed = { passed: 0, failed: 0 };
  const failures = [];
  const passed = [];

  for (const suite of results.testResults) {
    const category = getCategoryFromPath(suite.testFilePath);
    const isRuntime = category.startsWith('A');
    const isCompliance = category.startsWith('B');

    for (const test of suite.testResults) {
      if (test.status === 'passed') {
        totalPassed++;
        if (isRuntime) runtimePassed.passed++;
        if (isCompliance) compliancePassed.passed++;
        passed.push({ category, name: test.title });
      } else if (test.status === 'failed') {
        totalFailed++;
        if (isRuntime) runtimePassed.failed++;
        if (isCompliance) compliancePassed.failed++;
        failures.push({
          category,
          severity: SEVERITY_MAP[category] || 'MEDIUM',
          law: LAW_MAP[category] || 'N/A',
          name: test.title,
          error: test.failureMessages?.join('\n') || 'Unknown error',
          file: suite.testFilePath.replace(/.*tests[\\/]/, 'tests/'),
        });
      }
    }
  }

  const total = totalPassed + totalFailed;
  const criticalCount = failures.filter(f => f.severity === 'CRITICAL').length;
  const highCount = failures.filter(f => f.severity === 'HIGH').length;
  const mediumCount = failures.filter(f => f.severity === 'MEDIUM').length;
  const lowCount = failures.filter(f => f.severity === 'LOW').length;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<test-report date="${date}" duration="${duration}s">\n`;
  xml += `  <summary>\n`;
  xml += `    <total>${total}</total>\n`;
  xml += `    <passed>${totalPassed}</passed>\n`;
  xml += `    <failed>${totalFailed}</failed>\n`;
  xml += `    <severities critical="${criticalCount}" high="${highCount}" medium="${mediumCount}" low="${lowCount}" />\n`;
  xml += `    <categories>\n`;
  xml += `      <runtime passed="${runtimePassed.passed}" failed="${runtimePassed.failed}" />\n`;
  xml += `      <compliance passed="${compliancePassed.passed}" failed="${compliancePassed.failed}" />\n`;
  xml += `    </categories>\n`;
  xml += `  </summary>\n\n`;

  if (failures.length > 0) {
    xml += `  <failures>\n`;
    for (const f of failures) {
      xml += `    <failure severity="${f.severity}" category="${escapeXml(f.category)}" law="${escapeXml(f.law)}">\n`;
      xml += `      <test>${escapeXml(f.name)}</test>\n`;
      xml += `      <file>${escapeXml(f.file)}</file>\n`;
      xml += `      <error>${escapeXml(f.error.slice(0, 500))}</error>\n`;
      xml += `    </failure>\n`;
    }
    xml += `  </failures>\n\n`;
  }

  xml += `  <passed-tests count="${totalPassed}">\n`;
  for (const p of passed.slice(0, 50)) { // Limit to 50 for brevity
    xml += `    <test category="${escapeXml(p.category)}">${escapeXml(p.name)}</test>\n`;
  }
  if (passed.length > 50) {
    xml += `    <!-- ... ${passed.length - 50} more passed tests ... -->\n`;
  }
  xml += `  </passed-tests>\n`;
  xml += `</test-report>\n`;

  return {
    xml,
    summary: {
      total,
      passed: totalPassed,
      failed: totalFailed,
      critical_count: criticalCount,
      high_count: highCount,
      medium_count: mediumCount,
      low_count: lowCount,
      categories: {
        runtime: runtimePassed,
        compliance: compliancePassed,
      },
    },
  };
}

async function sendReport(xml, summary) {
  if (!TEST_REPORT_API_KEY) {
    console.log('\n⚠️  TEST_REPORT_API_KEY not set - skipping notification send');
    console.log('   Set it in .env.test to send reports to production');
    return;
  }

  try {
    const res = await fetch(`${REPORT_API_URL}/system/test-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Api-Key': TEST_REPORT_API_KEY,
      },
      body: JSON.stringify({ xml, summary }),
    });

    if (res.ok) {
      console.log('📧 Test report sent as notification to production');
    } else {
      const body = await res.text();
      console.error(`⚠️  Failed to send report: ${res.status} - ${body}`);
    }
  } catch (err) {
    console.error('⚠️  Failed to send report:', err.message);
  }
}

// Jest Reporter class
export default class HackerEticoReporter {
  constructor(globalConfig, reporterOptions) {
    this._startTime = Date.now();
  }

  async onRunComplete(testContexts, results) {
    const { xml, summary } = generateXml(results, this._startTime);

    // Always save locally
    const fs = await import('fs');
    fs.default.writeFileSync('test-report.xml', xml, 'utf-8');
    console.log('\n📄 XML report saved to backend/test-report.xml');

    // Summary to console
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔐 HACKER ETICO - TEST REPORT`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total: ${summary.total} | ✅ ${summary.passed} | ❌ ${summary.failed}`);
    if (summary.critical_count > 0) console.log(`  🔴 CRITICAL: ${summary.critical_count}`);
    if (summary.high_count > 0) console.log(`  🟠 HIGH: ${summary.high_count}`);
    if (summary.medium_count > 0) console.log(`  🟡 MEDIUM: ${summary.medium_count}`);
    if (summary.low_count > 0) console.log(`  🔵 LOW: ${summary.low_count}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Send to production
    return sendReport(xml, summary);
  }
}
