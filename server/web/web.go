// Package web embeds the static web app served by skyfid.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static
var static embed.FS

func FS() fs.FS {
	sub, _ := fs.Sub(static, "static")
	return sub
}
