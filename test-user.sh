USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
API_KEY="mt_$(openssl rand -hex 24)"
KEY_HASH=$(echo -n "$API_KEY" | shasum -a 256 | cut -d' ' -f1)
KEY_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "API Key (save this): $API_KEY"
echo "User ID: $USER_ID"
# Insert user
wrangler d1 execute DB --remote --command \
  "INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('$USER_ID', 'test@example.com', 'Test User', datetime('now'), datetime('now'))"
# Insert API key
wrangler d1 execute DB --remote --command \
  "INSERT INTO api_keys (id, user_id, key_hash, name, created_at) VALUES ('$KEY_ID', '$USER_ID', '$KEY_HASH', 'default', datetime('now'))"
