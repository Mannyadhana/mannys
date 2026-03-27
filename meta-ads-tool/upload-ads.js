require("dotenv").config();
const bizSdk = require("facebook-nodejs-business-sdk");
const fs = require("fs");
const path = require("path");

const accessToken = process.env.META_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT;
const pageId = process.env.META_PAGE_ID;

const api = bizSdk.FacebookAdsApi.init(accessToken);
const AdAccount = bizSdk.AdAccount;
const Page = bizSdk.Page;

const account = new AdAccount(adAccountId);

const CREATIVES_DIR = path.join(__dirname, "..", "ad-creatives");
const LOG_FILE = path.join(__dirname, "upload-log.txt");

const CAMPAIGN_ID = process.env.META_CAMPAIGN_ID || null;
const ADSET_ID = process.env.META_ADSET_ID || null;

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

async function createLeadForm() {
  log("Creating lead form with qualifying questions...");

  const page = new Page(pageId);
  const form = await page.createLeadGenForm([], {
    name: "Truganina Warehouse - Owner Occupier Enquiry",
    follow_up_action_url: "https://www.facebook.com/thanks",
    questions: [
      {
        type: "FULL_NAME",
        key: "full_name",
      },
      {
        type: "EMAIL",
        key: "email",
      },
      {
        type: "PHONE",
        key: "phone_number",
      },
      {
        type: "CUSTOM",
        key: "business_type",
        label: "What type of business do you operate?",
        options: [
          { value: "Logistics & Transport", key: "logistics" },
          { value: "Manufacturing", key: "manufacturing" },
          { value: "E-commerce & Warehousing", key: "ecommerce" },
          { value: "Trade Services (Plumber, Electrician, etc.)", key: "trades" },
          { value: "Other", key: "other" },
        ],
        type: "CUSTOM",
      },
      {
        type: "CUSTOM",
        key: "current_situation",
        label: "Are you currently renting or do you own your workspace?",
        options: [
          { value: "Renting — ready to buy", key: "renting_ready" },
          { value: "Renting — exploring options", key: "renting_exploring" },
          { value: "Own — looking to upgrade/relocate", key: "own_upgrade" },
          { value: "Starting a new business", key: "new_business" },
        ],
        type: "CUSTOM",
      },
      {
        type: "CUSTOM",
        key: "warehouse_size",
        label: "What size warehouse do you need?",
        options: [
          { value: "Small (100–300 sqm)", key: "small" },
          { value: "Medium (300–600 sqm)", key: "medium" },
          { value: "Large (600–1000 sqm)", key: "large" },
          { value: "Very Large (1000+ sqm)", key: "very_large" },
          { value: "Not sure yet", key: "unsure" },
        ],
        type: "CUSTOM",
      },
      {
        type: "CUSTOM",
        key: "budget_range",
        label: "What's your approximate budget?",
        options: [
          { value: "Under $500K", key: "under_500k" },
          { value: "$500K – $1M", key: "500k_1m" },
          { value: "$1M – $2M", key: "1m_2m" },
          { value: "$2M+", key: "over_2m" },
          { value: "Using SMSF", key: "smsf" },
        ],
        type: "CUSTOM",
      },
      {
        type: "CUSTOM",
        key: "timeline",
        label: "When are you looking to move in?",
        options: [
          { value: "ASAP (within 3 months)", key: "asap" },
          { value: "3–6 months", key: "3_6_months" },
          { value: "6–12 months", key: "6_12_months" },
          { value: "12+ months (happy to wait for off-the-plan)", key: "12_plus" },
        ],
        type: "CUSTOM",
      },
    ],
    privacy_policy: {
      url: "https://www.facebook.com/privacy/explanation",
    },
    context_card: {
      title: "Own Your Warehouse in Truganina",
      content: [
        "Brand new off-the-plan industrial warehouses in Truganina, Melbourne's fastest-growing industrial hub.",
        "Stop paying rent — build equity in your own purpose-built space.",
        "20km from Melbourne CBD, direct freeway & port access.",
        "Flexible sizes with warehouse + office combos available.",
        "Fill in the form below and our team will be in touch within 24 hours.",
      ],
      style: "PARAGRAPH_STYLE",
    },
    thank_you_page: {
      title: "Thanks for your enquiry!",
      body: "Our team will contact you within 24 hours to discuss available warehouses in Truganina that match your needs.",
      button_text: "Visit our page",
      button_type: "VIEW_WEBSITE",
      website_url: "https://www.facebook.com/" + pageId,
    },
  });

  const formId = form.id;
  log(`Lead form created: ${formId}`);
  return formId;
}

async function createCampaign() {
  if (CAMPAIGN_ID) return CAMPAIGN_ID;
  log("Creating campaign: Truganina Warehouses - Owner Occupier");
  const campaign = await account.createCampaign([], {
    name: "Truganina Warehouses - Owner Occupier",
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    special_ad_categories: [],
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

async function uploadAd(adSetId, leadFormId, creative, filename) {
  const slug = creative.variation_id || path.basename(filename, ".json");
  const ctaType = CTA_MAP[creative.cta] || "LEARN_MORE";

  try {
    const adCreative = await account.createAdCreative([], {
      name: `Creative: ${slug}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: creative.primary_text,
          name: creative.headline_pain,
          description: creative.description,
          call_to_action: {
            type: ctaType,
            value: { lead_gen_form_id: leadFormId },
          },
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

  const leadFormId = await createLeadForm();
  const campaignId = await createCampaign();
  const adSetId = await createAdSet(campaignId);

  log(`Using Campaign: ${campaignId}, Ad Set: ${adSetId}, Lead Form: ${leadFormId}`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(CREATIVES_DIR, file);
    const creative = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const result = await uploadAd(adSetId, leadFormId, creative, file);
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
