INSERT INTO methodology_versions(version, notes)
VALUES (
  'LT-1.1-PRECURSOR',
  'Precursor/order-acceleration upgrade. Search economic chain earlier: need -> capital commitment -> physical commitment -> procurement -> supplier -> public beneficiary -> headline. Early evidence does not override materiality. JARVIS GREEN still requires reported/verified company-specific evidence plus beneficiary materiality PASS. ARGUS recognition remains separate from company quality.'
)
ON CONFLICT (version) DO NOTHING;

-- Source priority for discovery adapters and research agents:
-- 1) exchange/regulatory filings
-- 2) award letters/procurement notices
-- 3) purchase orders/master supply agreements
-- 4) permits, utility/interconnection filings, capacity commitments
-- 5) capacity/manufacturing investments
-- 6) repeated related orders
-- 7) company releases
-- 8) mainstream news
--
-- Order acceleration semantics:
-- first economically relevant order => INVESTIGATE
-- second related order/award => ELEVATE
-- repeated orders + prior capital/capacity commitment => IMMEDIATE_REVIEW
--
-- Historical testing must preserve point-in-time evidence and score separately:
-- earliest defensible precursor, JARVIS qualification date, ARGUS recognition state,
-- and Starting Point / 3:1 execution outcome when technically definable.
