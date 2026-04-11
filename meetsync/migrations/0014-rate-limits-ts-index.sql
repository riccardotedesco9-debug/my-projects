-- Round 10 code review finding M3: the rate_limits cleanup query
-- is `DELETE FROM rate_limits WHERE ts < ?` with no chat_id filter.
-- The existing index idx_rate_limits_chat_id covers (chat_id, ts)
-- with chat_id as the leading column, so the cleanup scans the
-- whole table on every call. At 100k+ rate_limits rows this
-- becomes noticeable.
--
-- Add a second index on ts alone so the cleanup uses an index seek.
-- The existing (chat_id, ts) composite index stays for the per-chat
-- count queries (checkRateLimit's sliding-window count).

CREATE INDEX IF NOT EXISTS idx_rate_limits_ts ON rate_limits(ts);
