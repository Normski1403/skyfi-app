// Package config embeds the default configuration bundle (sites, procedures,
// operators). A bundle in the state directory (e.g. /var/lib/skyfi/config,
// later installed from the cloud admin interface) takes precedence.
package config

import (
	"embed"
	"io/fs"
)

//go:embed sites.json operators.json procedures
var defaults embed.FS

func Defaults() fs.FS { return defaults }
