require("dotenv").config();
const express = require("express");
const bizSdk = require("facebook-nodejs-business-sdk");
const path = require("path");
const { runOptimization } = require("./optimizer");

const app = express();
const PORT = process.env.PORT || 3000;

let checkNowState = {
  running: false,
  startedAt: null,
  lastResult: null,
  lastError: null,
};

const accessToken = process.env.META_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT;
const CTR_THRESHOLD = parseFloat(process.env.CTR_THRESHOLD || 2);
const ROAS_THRESHOLD = parseFloat(process.env.ROAS_THRESHOLD || 2);

bizSdk.FacebookAdsApi.init(accessToken);
const AdAccount = bizSdk.AdAccount;
const account = new AdAccount(adAccountId);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API: Get all campaigns
app.get("/api/campaigns", async (req, res) => {
  try {
    const campaigns = await account.getCampaigns(
      ["id", "name", "status", "objective", "daily_budget", "lifetime_budget"],
      { limit: 50 }
    );
    res.json(campaigns.map((c) => c._data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get ad sets for a campaign
app.get("/api/campaigns/:id/adsets", async (req, res) => {
  try {
    const campaign = new bizSdk.Campaign(req.params.id);
    const adSets = await campaign.getAdSets(
      ["id", "name", "status", "daily_budget", "optimization_goal", "targeting"],
      { limit: 100 }
    );
    res.json(adSets.map((a) => a._data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get ads with insights
app.get("/api/ads", async (req, res) => {
  try {
    const datePreset = req.query.date_preset || "last_7d";
    const campaignId = req.query.campaign_id;

    const params = {
      limit: 500,
      filtering: campaignId
        ? [{ field: "campaign.id", operator: "EQUAL", value: campaignId }]
        : [],
    };

    const ads = await account.getAds(
      ["id", "name", "status", "creative", "adset_id", "campaign_id"],
      params
    );

    const adIds = ads.map((a) => a.id);
    const insightsMap = {};

    // Fetch insights in batches
    for (const ad of ads) {
      try {
        const adObj = new bizSdk.Ad(ad.id);
        const insights = await adObj.getInsights(
          [
            "ad_id",
            "ad_name",
            "impressions",
            "clicks",
            "ctr",
            "cpc",
            "cpm",
            "spend",
            "actions",
            "cost_per_action_type",
            "reach",
            "frequency",
          ],
          { date_preset: datePreset }
        );
        if (insights.length > 0) {
          insightsMap[ad.id] = insights[0]._data;
        }
      } catch (e) {
        // No insights for this ad
      }
    }

    const result = ads.map((ad) => {
      const data = ad._data;
      const insight = insightsMap[ad.id] || {};

      const leads =
        insight.actions?.find(
          (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
        )?.value || 0;

      const costPerLead =
        insight.cost_per_action_type?.find(
          (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
        )?.value || 0;

      return {
        id: data.id,
        name: data.name,
        status: data.status,
        campaign_id: data.campaign_id,
        adset_id: data.adset_id,
        impressions: parseInt(insight.impressions || 0),
        clicks: parseInt(insight.clicks || 0),
        ctr: parseFloat(insight.ctr || 0),
        cpc: parseFloat(insight.cpc || 0),
        cpm: parseFloat(insight.cpm || 0),
        spend: parseFloat(insight.spend || 0),
        reach: parseInt(insight.reach || 0),
        frequency: parseFloat(insight.frequency || 0),
        leads: parseInt(leads),
        cost_per_lead: parseFloat(costPerLead),
      };
    });

    // Sort by CTR descending
    result.sort((a, b) => b.ctr - a.ctr);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Pause an ad
app.post("/api/ads/:id/pause", async (req, res) => {
  try {
    const ad = new bizSdk.Ad(req.params.id);
    await ad.update([], { status: "PAUSED" });
    res.json({ success: true, status: "PAUSED" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Activate an ad
app.post("/api/ads/:id/activate", async (req, res) => {
  try {
    const ad = new bizSdk.Ad(req.params.id);
    await ad.update([], { status: "ACTIVE" });
    res.json({ success: true, status: "ACTIVE" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get summary stats
app.get("/api/summary", async (req, res) => {
  try {
    const datePreset = req.query.date_preset || "last_7d";
    const insights = await account.getInsights(
      [
        "impressions",
        "clicks",
        "ctr",
        "spend",
        "cpc",
        "cpm",
        "actions",
        "cost_per_action_type",
        "reach",
        "frequency",
      ],
      {
        date_preset: datePreset,
        filtering: [
          { field: "campaign.name", operator: "CONTAIN", value: "Truganina" },
        ],
      }
    );

    if (insights.length === 0) {
      return res.json({
        impressions: 0, clicks: 0, ctr: 0, spend: 0,
        cpc: 0, cpm: 0, leads: 0, cost_per_lead: 0, reach: 0,
      });
    }

    const data = insights[0]._data;
    const leads =
      data.actions?.find(
        (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
      )?.value || 0;
    const costPerLead =
      data.cost_per_action_type?.find(
        (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
      )?.value || 0;

    res.json({
      impressions: parseInt(data.impressions || 0),
      clicks: parseInt(data.clicks || 0),
      ctr: parseFloat(data.ctr || 0),
      spend: parseFloat(data.spend || 0),
      cpc: parseFloat(data.cpc || 0),
      cpm: parseFloat(data.cpm || 0),
      reach: parseInt(data.reach || 0),
      frequency: parseFloat(data.frequency || 0),
      leads: parseInt(leads),
      cost_per_lead: parseFloat(costPerLead),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get thresholds
app.get("/api/thresholds", (req, res) => {
  res.json({ ctr: CTR_THRESHOLD, roas: ROAS_THRESHOLD });
});

// API: Trigger an on-demand optimizer run
app.post("/api/check-now", async (req, res) => {
  if (checkNowState.running) {
    return res.status(409).json({
      error: "Optimization already running",
      startedAt: checkNowState.startedAt,
    });
  }

  checkNowState = {
    running: true,
    startedAt: new Date().toISOString(),
    lastResult: checkNowState.lastResult,
    lastError: null,
  };

  // Run in background so request returns quickly
  runOptimization()
    .then((result) => {
      checkNowState = {
        running: false,
        startedAt: null,
        lastResult: result,
        lastError: null,
      };
    })
    .catch((err) => {
      checkNowState = {
        running: false,
        startedAt: null,
        lastResult: checkNowState.lastResult,
        lastError: err.message,
      };
    });

  res.json({ started: true, startedAt: checkNowState.startedAt });
});

// API: Poll the state of on-demand optimizer runs
app.get("/api/check-now/status", (req, res) => {
  res.json(checkNowState);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on http://0.0.0.0:${PORT}`);
});
