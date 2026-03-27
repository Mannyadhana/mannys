require("dotenv").config();
const bizSdk = require("facebook-nodejs-business-sdk");
const fs = require("fs");
const path = require("path");

const accessToken = process.env.META_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT;
const pageId = process.env.META_PAGE_ID;

const api = bizSdk.FacebookAdsApi.init(accessToken);
const AdAccount = bizSdk.AdAccount;
const account = new AdAccount(adAccountId);

const GENERATED_DIR = path.join(__dirname, "..", "generated-creatives");
const CREATIVES_DIR = path.join(__dirname, "..", "ad-creatives");
const LOG_FILE = path.join(__dirname, "attach-log.txt");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

async function getExistingAds() {
  const ads = await account.getAds(["id", "name", "status", "creative"], {
    limit: 500,
    filtering: [{ field: "campaign.name", operator: "CONTAIN", value: "Truganina" }],
  });
  return ads;
}

async function uploadImage(imagePath) {
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const result = await account.createAdImage([], {
    bytes: imageData,
  });
  const images = result._data && result._data.images;
  if (images) {
    const key = Object.keys(images)[0];
    return images[key].hash;
  }
  throw new Error("Failed to get image hash from upload response");
}

async function main() {
  log("=== Attaching Creatives to Ads ===");

  const pngFiles = fs.readdirSync(GENERATED_DIR).filter((f) => f.endsWith(".png")).sort();
  log(`Found ${pngFiles.length} generated creative images`);

  const ads = await getExistingAds();
  log(`Found ${ads.length} existing ads in Truganina campaign`);

  const adMap = {};
  for (const ad of ads) {
    adMap[ad.name] = ad;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const pngFile of pngFiles) {
    const adName = pngFile.replace(".png", "");
    const ad = adMap[adName];

    if (!ad) {
      log(`SKIP: No matching ad for ${adName}`);
      skipped++;
      continue;
    }

    const imagePath = path.join(GENERATED_DIR, pngFile);
    const creativePath = path.join(CREATIVES_DIR, pngFile.replace(".png", ".json"));

    try {
      const creative = JSON.parse(fs.readFileSync(creativePath, "utf8"));
      const imageHash = await uploadImage(imagePath);

      const adCreative = await account.createAdCreative([], {
        name: `Creative-v2: ${adName}`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            message: creative.primary_text,
            name: creative.headline_pain,
            description: creative.description,
            image_hash: imageHash,
            call_to_action: {
              type: "LEARN_MORE",
              value: { lead_gen_form_id: process.env.LEAD_FORM_ID || "" },
            },
          },
        },
      });

      await new bizSdk.Ad(ad.id).update([], {
        creative: { creative_id: adCreative.id },
      });

      log(`SUCCESS: ${adName} -> image attached`);
      success++;
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.error) : err.message;
      log(`FAILED: ${adName} -> ${msg}`);
      failed++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  log(`=== Done: ${success} success, ${failed} failed, ${skipped} skipped ===`);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
