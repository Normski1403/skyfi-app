package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/zimchaa/skyfi-app/server/internal/preflight"
)

// Pre-flight API (config-driven wizard, sealing, clearance, override).
func (s *Server) preflightRoutes(mux *http.ServeMux) {
	if s.PF == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/preflight/config", s.pfConfig)
	mux.HandleFunc("GET /api/v1/preflight/clearance", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.PF.Current())
	})
	mux.HandleFunc("GET /api/v1/preflights", s.pfList)
	mux.HandleFunc("POST /api/v1/preflights", s.pfStart)
	mux.HandleFunc("GET /api/v1/preflights/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.PF.Get(r.PathValue("id"))
		reply(w, v, err)
	})
	mux.HandleFunc("PUT /api/v1/preflights/{id}/steps/{step}", s.pfSaveStep)
	mux.HandleFunc("POST /api/v1/preflights/{id}/complete", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.PF.Complete(r.PathValue("id"))
		reply(w, v, err)
	})
	mux.HandleFunc("POST /api/v1/preflights/{id}/void", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]any{"ok": true}, s.PF.Void(r.PathValue("id")))
	})
	mux.HandleFunc("GET /api/v1/preflights/{id}/record", s.pfRecord)
	mux.HandleFunc("POST /api/v1/override", s.pfOverride)
	mux.HandleFunc("POST /api/v1/blobs", s.blobPut)
	mux.HandleFunc("GET /api/v1/blobs/{id}", s.blobGet)
}

func reply(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) pfConfig(w http.ResponseWriter, r *http.Request) {
	b := s.PF.Bundle()
	type siteInfo struct {
		preflight.Site
		ProcedureTitle string `json:"procedure_title"`
		StepCount      int    `json:"step_count"`
	}
	sites := []siteInfo{}
	for _, st := range b.Sites {
		p := b.Procedures[st.Procedure]
		sites = append(sites, siteInfo{st, p.Title + " v" + p.Version, len(p.Steps)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sites": sites, "operators": b.Operators})
}

func (s *Server) pfList(w http.ResponseWriter, r *http.Request) {
	runs, err := s.PF.Store().ListRuns(30)
	if err != nil {
		reply(w, nil, err)
		return
	}
	type item struct {
		*preflight.Run
		SiteName string `json:"site_name"`
		PicName  string `json:"pic_name"`
	}
	out := []item{}
	for _, run := range runs {
		run.Data = nil // list view: no answers
		site, _ := s.PF.Bundle().Site(run.SiteID)
		pic, _ := s.PF.Bundle().Operator(run.PicID)
		out = append(out, item{run, site.Name, pic.Name})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) pfStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SiteID string `json:"site_id"`
	}
	if err := readJSON(r, &req); err != nil {
		reply(w, nil, err)
		return
	}
	v, err := s.PF.Start(req.SiteID)
	reply(w, v, err)
}

func (s *Server) pfSaveStep(w http.ResponseWriter, r *http.Request) {
	var values map[string]any
	defer r.Body.Close()
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&values); err != nil {
		reply(w, nil, err)
		return
	}
	v, err := s.PF.SaveStep(r.PathValue("id"), r.PathValue("step"), values)
	reply(w, v, err)
}

func (s *Server) pfRecord(w http.ResponseWriter, r *http.Request) {
	rec, err := s.PF.Store().Record(r.PathValue("id"))
	if err != nil {
		reply(w, nil, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="`+r.PathValue("id")+`.json"`)
	_, _ = io.WriteString(w, rec)
}

func (s *Server) pfOverride(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SiteID     string `json:"site_id"`
		OperatorID string `json:"operator_id"`
		Reason     string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		reply(w, nil, err)
		return
	}
	c, err := s.PF.Override(req.SiteID, req.OperatorID, req.Reason)
	if err == nil {
		s.Station.Note("override", req.OperatorID, "EMERGENCY OVERRIDE at "+c.SiteName+" by "+c.By+": "+req.Reason)
	}
	reply(w, c, err)
}

// Photos and signatures: content-addressed, images only, 8MB max.
func (s *Server) blobPut(w http.ResponseWriter, r *http.Request) {
	ct := r.Header.Get("Content-Type")
	if ct != "image/jpeg" && ct != "image/png" && ct != "image/webp" {
		reply(w, nil, errString("images only (jpeg/png/webp)"))
		return
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8<<20))
	if err != nil {
		reply(w, nil, err)
		return
	}
	id, err := s.PF.Store().PutBlob(b)
	reply(w, map[string]any{"id": id}, err)
}

func (s *Server) blobGet(w http.ResponseWriter, r *http.Request) {
	p, ok := s.PF.Store().BlobPath(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, p)
}

type errString string

func (e errString) Error() string { return string(e) }
