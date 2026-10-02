package preflight

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Store persists runs and overrides in SQLite (WAL) and blobs (photos,
// signatures) as content-addressed files.
type Store struct {
	db      *sql.DB
	blobDir string
	key     ed25519.PrivateKey
}

const schema = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  procedure_id TEXT NOT NULL,
  procedure_version TEXT NOT NULL,
  status TEXT NOT NULL,             -- draft | complete | void
  data TEXT NOT NULL,               -- JSON answers
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  pic_id TEXT,
  max_alt_m REAL,
  target_alt_m REAL,
  record TEXT,                      -- canonical sealed JSON
  seal_hash TEXT,
  seal_sig TEXT,
  sync_status TEXT                  -- pending | synced (cloud outbox)
);
CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  record TEXT NOT NULL,
  seal_hash TEXT NOT NULL,
  seal_sig TEXT NOT NULL,
  sync_status TEXT NOT NULL
);`

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "blobs"), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "skyfi.db")+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(filepath.Join(dir, "device.key"))
	if err != nil {
		return nil, err
	}
	return &Store{db: db, blobDir: filepath.Join(dir, "blobs"), key: key}, nil
}

// loadOrCreateKey keeps the device's Ed25519 signing key (seed) on disk.
// Phase 3 moves this into a secure element.
func loadOrCreateKey(path string) (ed25519.PrivateKey, error) {
	if seed, err := os.ReadFile(path); err == nil && len(seed) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(seed), nil
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return priv, os.WriteFile(path, priv.Seed(), 0o600)
}

func (s *Store) PublicKey() string {
	return base64.StdEncoding.EncodeToString(s.key.Public().(ed25519.PublicKey))
}

// seal hashes the canonical record and signs the hash.
func (s *Store) seal(record any) (canon []byte, hash, sig string, err error) {
	canon, err = json.Marshal(record) // struct fields in order, map keys sorted
	if err != nil {
		return nil, "", "", err
	}
	sum := sha256.Sum256(canon)
	return canon, hex.EncodeToString(sum[:]),
		base64.StdEncoding.EncodeToString(ed25519.Sign(s.key, sum[:])), nil
}

// ── blobs ────────────────────────────────────────────────────────────

func (s *Store) PutBlob(b []byte) (string, error) {
	sum := sha256.Sum256(b)
	id := hex.EncodeToString(sum[:])
	p := filepath.Join(s.blobDir, id)
	if _, err := os.Stat(p); err == nil {
		return id, nil
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return "", err
	}
	return id, os.Rename(tmp, p)
}

func (s *Store) BlobPath(id string) (string, bool) {
	if len(id) != 64 {
		return "", false
	}
	if _, err := hex.DecodeString(id); err != nil {
		return "", false
	}
	p := filepath.Join(s.blobDir, id)
	_, err := os.Stat(p)
	return p, err == nil
}

func (s *Store) BlobExists(id string) bool { _, ok := s.BlobPath(id); return ok }

// ── runs ─────────────────────────────────────────────────────────────

type Run struct {
	ID               string     `json:"id"`
	SiteID           string     `json:"site_id"`
	ProcedureID      string     `json:"procedure_id"`
	ProcedureVersion string     `json:"procedure_version"`
	Status           string     `json:"status"`
	Data             Data       `json:"data"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	PicID            string     `json:"pic_id,omitempty"`
	MaxAltM          float64    `json:"max_alt_m,omitempty"`
	TargetAltM       float64    `json:"target_alt_m,omitempty"`
	SealHash         string     `json:"seal_hash,omitempty"`
	SealSig          string     `json:"seal_sig,omitempty"`
	SyncStatus       string     `json:"sync_status,omitempty"`
}

const runCols = `id, site_id, procedure_id, procedure_version, status, data, created_at, updated_at,
  completed_at, expires_at, COALESCE(pic_id,''), COALESCE(max_alt_m,0), COALESCE(target_alt_m,0),
  COALESCE(seal_hash,''), COALESCE(seal_sig,''), COALESCE(sync_status,'')`

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func scanRun(row interface{ Scan(...any) error }) (*Run, error) {
	var r Run
	var data, created, updated string
	var completed, expires sql.NullString
	if err := row.Scan(&r.ID, &r.SiteID, &r.ProcedureID, &r.ProcedureVersion, &r.Status, &data,
		&created, &updated, &completed, &expires, &r.PicID, &r.MaxAltM, &r.TargetAltM,
		&r.SealHash, &r.SealSig, &r.SyncStatus); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(data), &r.Data); err != nil {
		return nil, err
	}
	r.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	r.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if completed.Valid {
		t, _ := time.Parse(time.RFC3339Nano, completed.String)
		r.CompletedAt = &t
	}
	if expires.Valid {
		t, _ := time.Parse(time.RFC3339Nano, expires.String)
		r.ExpiresAt = &t
	}
	return &r, nil
}

func (s *Store) CreateRun(r *Run) error {
	data, _ := json.Marshal(r.Data)
	_, err := s.db.Exec(`INSERT INTO runs (id, site_id, procedure_id, procedure_version, status, data, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?)`, r.ID, r.SiteID, r.ProcedureID, r.ProcedureVersion, r.Status, string(data), ts(r.CreatedAt), ts(r.UpdatedAt))
	return err
}

func (s *Store) GetRun(id string) (*Run, error) {
	r, err := scanRun(s.db.QueryRow(`SELECT `+runCols+` FROM runs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("no pre-flight %s", id)
	}
	return r, err
}

func (s *Store) ListRuns(limit int) ([]*Run, error) {
	rows, err := s.db.Query(`SELECT `+runCols+` FROM runs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SaveDraft(id string, data Data, now time.Time) error {
	b, _ := json.Marshal(data)
	res, err := s.db.Exec(`UPDATE runs SET data = ?, updated_at = ? WHERE id = ? AND status = 'draft'`, string(b), ts(now), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("pre-flight %s is not an editable draft", id)
	}
	return nil
}

func (s *Store) VoidRun(id string, now time.Time) error {
	_, err := s.db.Exec(`UPDATE runs SET status = 'void', updated_at = ? WHERE id = ? AND status IN ('draft','complete')`, ts(now), id)
	return err
}

func (s *Store) completeRun(r *Run, record []byte) error {
	data, _ := json.Marshal(r.Data)
	_, err := s.db.Exec(`UPDATE runs SET status='complete', data=?, updated_at=?, completed_at=?, expires_at=?,
		pic_id=?, max_alt_m=?, target_alt_m=?, record=?, seal_hash=?, seal_sig=?, sync_status='pending'
		WHERE id=? AND status='draft'`,
		string(data), ts(*r.CompletedAt), ts(*r.CompletedAt), ts(*r.ExpiresAt), r.PicID, r.MaxAltM, r.TargetAltM,
		string(record), r.SealHash, r.SealSig, r.ID)
	return err
}

func (s *Store) Record(id string) (string, error) {
	var rec sql.NullString
	err := s.db.QueryRow(`SELECT record FROM runs WHERE id = ?`, id).Scan(&rec)
	if err == nil && !rec.Valid {
		err = fmt.Errorf("pre-flight %s is not sealed", id)
	}
	return rec.String, err
}

// ── overrides ────────────────────────────────────────────────────────

type Override struct {
	ID         string    `json:"id"`
	SiteID     string    `json:"site_id"`
	OperatorID string    `json:"operator_id"`
	Reason     string    `json:"reason"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	SealHash   string    `json:"seal_hash"`
	SealSig    string    `json:"seal_sig"`
	SyncStatus string    `json:"sync_status"`
}

func (s *Store) addOverride(o *Override, record []byte) error {
	_, err := s.db.Exec(`INSERT INTO overrides (id, site_id, operator_id, reason, created_at, expires_at, record, seal_hash, seal_sig, sync_status)
		VALUES (?,?,?,?,?,?,?,?,?, 'pending')`, o.ID, o.SiteID, o.OperatorID, o.Reason, ts(o.CreatedAt), ts(o.ExpiresAt),
		string(record), o.SealHash, o.SealSig)
	return err
}

func (s *Store) latestOverride() (*Override, error) {
	var o Override
	var created, expires string
	err := s.db.QueryRow(`SELECT id, site_id, operator_id, reason, created_at, expires_at, seal_hash, seal_sig, sync_status
		FROM overrides ORDER BY created_at DESC LIMIT 1`).Scan(&o.ID, &o.SiteID, &o.OperatorID, &o.Reason,
		&created, &expires, &o.SealHash, &o.SealSig, &o.SyncStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	o.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	o.ExpiresAt, _ = time.Parse(time.RFC3339Nano, expires)
	return &o, err
}

func (s *Store) latestComplete() (*Run, error) {
	r, err := scanRun(s.db.QueryRow(`SELECT ` + runCols + ` FROM runs WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) Close() error { return s.db.Close() }
