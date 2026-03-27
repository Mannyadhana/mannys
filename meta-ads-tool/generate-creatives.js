const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const CREATIVES_DIR = path.join(__dirname, "..", "ad-creatives");
const OUTPUT_DIR = path.join(__dirname, "..", "generated-creatives");
const SOURCE_DIR = path.join(__dirname, "..", "source-images");

const COLORS = {
  financial: { bg: "rgba(15, 52, 96, 0.85)", accent: "#4FC3F7" },
  growth: { bg: "rgba(13, 71, 35, 0.85)", accent: "#66BB6A" },
  urgency: { bg: "rgba(113, 18, 18, 0.85)", accent: "#EF5350" },
  trust: { bg: "rgba(55, 35, 90, 0.85)", accent: "#AB47BC" },
  default: { bg: "rgba(20, 20, 20, 0.85)", accent: "#FFB300" },
};

const CATEGORY_MAP = {
  "rising-rents": "financial",
  "dead-money": "financial",
  "stuck-renting": "financial",
  "hidden-costs": "financial",
  "interest-rates": "financial",
  "tax-depreciation": "financial",
  "smsf-confusion": "financial",
  "cashflow-construction": "financial",
  "flexible-space": "growth",
  "warehouse-office": "growth",
  "no-stock": "growth",
  "location-concerns": "growth",
  "infrastructure": "growth",
  "lease-expiring": "urgency",
  "buying-wrong-time": "urgency",
  "priced-out": "urgency",
  "landlord-control": "urgency",
  "construction-quality": "trust",
  "off-the-plan-process": "trust",
  "retirement-income": "financial",
};

function getCategory(filename) {
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (filename.includes(key)) return cat;
  }
  return "default";
}

function getSourceImages() {
  if (!fs.existsSync(SOURCE_DIR)) return [];
  const walk = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results = results.concat(walk(full));
      else if (/\.(png|jpg|jpeg|webp)$/i.test(file)) results.push(full);
    }
    return results;
  };
  return walk(SOURCE_DIR);
}

function generateHTML(creative, bgImage, colors, category) {
  const headline = creative.headline_pain || "";
  const outcome = creative.headline_outcome || "";
  const bgStyle = bgImage
    ? `background-image: url('file://${bgImage}'); background-size: cover; background-position: center;`
    : `background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);`;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 628px; overflow: hidden; font-family: 'Inter', 'Arial Black', sans-serif; }
  .container {
    width: 1200px; height: 628px; position: relative;
    ${bgStyle}
  }
  .overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(
      135deg,
      ${colors.bg} 0%,
      rgba(0,0,0,0.4) 100%
    );
  }
  .content {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; justify-content: center;
    padding: 60px 80px;
  }
  .badge {
    display: inline-block; padding: 8px 20px; border-radius: 4px;
    background: ${colors.accent}; color: #000; font-size: 16px;
    font-weight: 700; text-transform: uppercase; letter-spacing: 2px;
    margin-bottom: 24px; width: fit-content;
  }
  .headline {
    font-size: 58px; font-weight: 900; color: #fff; line-height: 1.1;
    margin-bottom: 20px; max-width: 800px;
    text-shadow: 2px 2px 8px rgba(0,0,0,0.5);
  }
  .subheadline {
    font-size: 28px; font-weight: 600; color: ${colors.accent};
    margin-bottom: 32px; max-width: 700px;
  }
  .cta-btn {
    display: inline-block; padding: 16px 40px; border-radius: 6px;
    background: ${colors.accent}; color: #000; font-size: 20px;
    font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    width: fit-content;
  }
  .location {
    position: absolute; bottom: 30px; right: 40px;
    color: rgba(255,255,255,0.8); font-size: 16px; font-weight: 600;
    letter-spacing: 1px;
  }
  .logo-area {
    position: absolute; top: 30px; right: 40px;
    color: #fff; font-size: 14px; font-weight: 700;
    text-align: right; line-height: 1.4;
  }
  .logo-area .brand { font-size: 18px; color: ${colors.accent}; }
</style>
</head>
<body>
<div class="container">
  <div class="overlay"></div>
  <div class="content">
    <div class="badge">Truganina Warehouses</div>
    <div class="headline">${headline}</div>
    <div class="subheadline">${outcome}</div>
    <div class="cta-btn">Enquire Now</div>
  </div>
  <div class="location">📍 Truganina, VIC — 20km from Melbourne CBD</div>
  <div class="logo-area">
    <div class="brand">Manny Singh</div>
    Fairmont Property Group
  </div>
</div>
</body>
</html>`;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(CREATIVES_DIR).filter((f) => f.endsWith(".json")).sort();
  const sourceImages = getSourceImages();

  console.log(`Found ${files.length} ad creatives`);
  console.log(`Found ${sourceImages.length} source images`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let success = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(CREATIVES_DIR, file);
    const creative = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const category = getCategory(file);
    const colors = COLORS[category] || COLORS.default;
    const bgImage = sourceImages.length > 0 ? sourceImages[i % sourceImages.length] : null;

    const outputFile = path.join(OUTPUT_DIR, file.replace(".json", ".png"));

    try {
      const html = generateHTML(creative, bgImage, colors, category);
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 628 });
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.screenshot({ path: outputFile, type: "png" });
      await page.close();
      success++;
      if ((i + 1) % 10 === 0) console.log(`Generated ${i + 1}/${files.length}`);
    } catch (err) {
      console.error(`FAILED: ${file} -> ${err.message}`);
      failed++;
    }
  }

  await browser.close();
  console.log(`\nDone: ${success} success, ${failed} failed out of ${files.length}`);
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
