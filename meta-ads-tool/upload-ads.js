require("dotenv").config();
const bizSdk = require("facebook-nodejs-business-sdk");
const fs = require("fs");
const path = require("path");

const accessToken = process.env.META_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT;
const pageId = process.env.META_PAGE_ID;

const api = bizSdk.FacebookAdsApi.init(accessToken);
const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
const Ad = bizSdk.Ad;
const AdCreative = bizSdk.AdCreative;

const account = new AdAccount(adAccountId);

const CREATIVES_DIR = path.join(__dirname, "..", "ad-creatives");
const LOG_FILE = path.join(__dirname, "upload-log.txt");

// Config — set these or pass via env/CLI
const CAMPAIGN_ID = process.env.META_CAMPAIGN_ID || null;
const ADSET_ID = process.env.META_ADSET_ID || null;
const LANDING_URL = process.env.LANDING_URL || "https://example.com";

const CTA_MAP = {
  "Learn More": "LEARN_MORE",
  "Shop Now": "SHOP_NOW",
  "Get Started": "GET_STARTED",
  "Sign Up": "SIGN_UP",
};

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

async function createCampaign() {
  if (CAMPAIGN_ID) return CAMPAIGN_ID;
  log("Creating campaign: Truganina Warehouses - Owner Occupier");
  const campaign = await account.createCampaign([], {
    name: "Truganina Warehouses - Owner Occupier",
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    special_ad_categories: ["HOUSING"],
  });
  const id = campaign.id;
  log(`Campaign created: ${id}`);
  return id;
}

async function createAdSet(campaignId) {
  if (ADSET_ID) return ADSET_ID;
  log("Creating ad set: Truganina OO - All Variations");
  const adSet = await account.createAdSet([], {
    name: "Truganina OO - All Variations",
    campaign_id: campaignId,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LEAD_GENERATION",
    daily_budget: 2000, // $20/day in cents
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    status: "PAUSED",
    targeting: {
      geo_locations: {
        cities: [
          {
            key: "2147714", // Melbourne
            radius: 50,
            distance_unit: "kilometer",
          },
        ],
      },
      age_min: 25,
      age_max: 65,
    },
    start_time: new Date(Date.now() + 86400000).toISOString(),
  });
  const id = adSet.id;
  log(`Ad set created: ${id}`);
  return id;
}

async function uploadAd(adSetId, creative, filename) {
  const slug = creative.variation_id || path.basename(filename, ".json");
  const ctaType = CTA_MAP[creative.cta] || "LEARN_MORE";

  try {
    const adCreative = await account.createAdCreative([], {
      name: `Creative: ${slug}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: creative.primary_text,
          link: LANDING_URL,
          name: creative.headline_pain,
          description: creative.description,
          call_to_action: { type: ctaType, value: { link: LANDING_URL } },
        },
      },
    });

    const ad = await account.createAd([], {
      name: slug,
      adset_id: adSetId,
      creative: { creative_id: adCreative.id },
      status: "PAUSED",
    });

    log(`SUCCESS: ${slug} -> Ad ID: ${ad.id}, Creative ID: ${adCreative.id}`);
    return { success: true, slug, adId: ad.id };
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.error) : err.message;
    log(`FAILED: ${slug} -> ${msg}`);
    return { success: false, slug, error: msg };
  }
}

async function main() {
  log("=== Meta Ads Upload Started ===");

  const files = fs
    .readdirSync(CREATIVES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  log(`Found ${files.length} creative files`);

  const campaignId = await createCampaign();
  const adSetId = await createAdSet(campaignId);

  log(`Using Campaign: ${campaignId}, Ad Set: ${adSetId}`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(CREATIVES_DIR, file);
    const creative = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const result = await uploadAd(adSetId, creative, file);
    if (result.success) success++;
    else failed++;

    // Rate limiting — small delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  log(`=== Upload Complete: ${success} success, ${failed} failed out of ${files.length} ===`);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
