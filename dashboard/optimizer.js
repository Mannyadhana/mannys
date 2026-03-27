require("dotenv").config();
const bizSdk = require("facebook-nodejs-business-sdk");
const fs = require("fs");
const path = require("path");

const accessToken = process.env.META_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT;
const CTR_THRESHOLD = parseFloat(process.env.CTR_THRESHOLD || 2);
const MIN_IMPRESSIONS = parseInt(process.env.MIN_IMPRESSIONS || 500);
const MAX_CPL = parseFloat(process.env.MAX_COST_PER_LEAD || 50);
const MAX_FREQUENCY = parseFloat(process.env.MAX_FREQUENCY || 3);
const CHECK_INTERVAL_HOURS = parseInt(process.env.CHECK_INTERVAL_HOURS || 6);

bizSdk.FacebookAdsApi.init(accessToken);
const AdAccount = bizSdk.AdAccount;
const account = new AdAccount(adAccountId);

const LOG_FILE = path.join(__dirname, "optimizer-log.txt");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

async function getActiveAds() {
  const ads = await account.getAds(["id", "name", "status", "campaign_id"], {
    limit: 500,
    filtering: [
      { field: "campaign.name", operator: "CONTAIN", value: "Truganina" },
      { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
    ],
  });
  return ads;
}

async function getAdInsights(adId) {
  try {
    const ad = new bizSdk.Ad(adId);
    const insights = await ad.getInsights(
      [
        "ad_id", "impressions", "clicks", "ctr", "cpc", "cpm",
        "spend", "actions", "cost_per_action_type", "reach", "frequency",
      ],
      { date_preset: "last_7d" }
    );
    if (insights.length > 0) return insights[0]._data;
    return null;
  } catch (e) {
    return null;
  }
}

async function pauseAd(adId, reason) {
  const ad = new bizSdk.Ad(adId);
  await ad.update([], { status: "PAUSED" });
  log(`PAUSED: ${adId} - Reason: ${reason}`);
}

async function runOptimization() {
  log("=== Optimization Check Started ===");

  const ads = await getActiveAds();
  log(`Found ${ads.length} active ads in Truganina campaigns`);

  let paused = 0;
  let winners = 0;
  let needsData = 0;

  for (const ad of ads) {
    const data = ad._data;
    const insights = await getAdInsights(data.id);

    if (!insights) {
      needsData++;
      continue;
    }

    const impressions = parseInt(insights.impressions || 0);
    const clicks = parseInt(insights.clicks || 0);
    const ctr = parseFloat(insights.ctr || 0);
    const spend = parseFloat(insights.spend || 0);
    const frequency = parseFloat(insights.frequency || 0);

    const leads = insights.actions?.find(
      (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    )?.value || 0;

    const costPerLead = insights.cost_per_action_type?.find(
      (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    )?.value || 0;

    // Rule 1: Kill ads with high impressions but zero clicks
    if (impressions >= MIN_IMPRESSIONS && clicks === 0) {
      await pauseAd(data.id, `Zero clicks after ${impressions} impressions - ${data.name}`);
      paused++;
      continue;
    }

    // Rule 2: Kill ads with very low CTR after sufficient impressions
    if (impressions >= MIN_IMPRESSIONS && ctr < 0.5) {
      await pauseAd(data.id, `CTR too low: ${ctr.toFixed(2)}% after ${impressions} impressions - ${data.name}`);
      paused++;
      continue;
    }

    // Rule 3: Kill ads with cost per lead exceeding threshold
    if (parseInt(leads) === 0 && spend > MAX_CPL) {
      await pauseAd(data.id, `Spent $${spend.toFixed(2)} with zero leads - ${data.name}`);
      paused++;
      continue;
    }

    if (parseFloat(costPerLead) > MAX_CPL && parseInt(leads) > 0) {
      await pauseAd(data.id, `Cost per lead too high: $${parseFloat(costPerLead).toFixed(2)} - ${data.name}`);
      paused++;
      continue;
    }

    // Rule 4: Pause ads with high frequency (ad fatigue)
    if (frequency > MAX_FREQUENCY && impressions >= MIN_IMPRESSIONS) {
      await pauseAd(data.id, `Ad fatigue - frequency ${frequency.toFixed(1)} exceeds ${MAX_FREQUENCY} - ${data.name}`);
      paused++;
      continue;
    }

    // Rule 5: Flag winners
    if (ctr >= CTR_THRESHOLD && impressions >= MIN_IMPRESSIONS) {
      winners++;
      log(`WINNER: ${data.name} - CTR: ${ctr.toFixed(2)}%, Leads: ${leads}, CPL: $${parseFloat(costPerLead).toFixed(2)}`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  log(`=== Optimization Complete ===`);
  log(`Results: ${winners} winners, ${paused} paused, ${needsData} need more data`);
  log(`Active ads remaining: ${ads.length - paused}`);
  log(`Next check in ${CHECK_INTERVAL_HOURS} hours`);
  log("");
}

async function startLoop() {
  log(`Optimizer started - checking every ${CHECK_INTERVAL_HOURS} hours`);
  log(`Rules: Kill CTR < 0.5% after ${MIN_IMPRESSIONS} imp | Kill CPL > $${MAX_CPL} | Kill frequency > ${MAX_FREQUENCY}`);
  log("");

  // Run immediately
  await runOptimization();

  // Then run on interval
  setInterval(async () => {
    try {
      await runOptimization();
    } catch (err) {
      log(`ERROR: ${err.message}`);
    }
  }, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
}

startLoop().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
