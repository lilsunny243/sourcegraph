package background

// Parse vulnerabilities from the golang/VulnDB (Govulndb) database.
// Govulndb uses the Open Source Vulnerability (OSV) format, with some custom extensions.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mitchellh/mapstructure"

	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/sentinel/shared"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

// ReadGoVulnDb fetches a copy of the Go Vulnerability Database and converts it to the internal Vulnerability format
func ReadGoVulnDb(ctx context.Context) (vulns []shared.Vulnerability, err error) {
	// TODO: Fetch database

	// Open test directory of json files
	path := "./go-vulndb/"
	fileList, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	for _, file := range fileList {
		if filepath.Ext(file.Name()) != ".json" {
			continue
		}

		fullPath := filepath.Join(path, file.Name())
		r, err := os.Open(fullPath)
		if err != nil {
			return nil, err
		}
		defer r.Close()

		var osvVuln OSV
		if err := json.NewDecoder(r).Decode(&osvVuln); err != nil {
			return nil, err
		}

		// Convert OSV to Vulnerability using Govulndb handler
		var g Govulndb
		convertedVuln, err := osvToVuln(osvVuln, g)
		if err != nil {
			return nil, err
		}

		out, err := json.MarshalIndent(convertedVuln, "", "  ")
		if err != nil {
			return nil, err
		}
		fmt.Printf("%s\n\n", string(out))

		vulns = append(vulns, convertedVuln)
	}

	return vulns, nil
}

//
// Govulndb-specific structs and handlers
//

// GovulndbAffectedEcosystemSpecific represents the custom data format used by Govulndb for OSV.Affected.EcosystemSpecific
type GovulndbAffectedEcosystemSpecific struct {
	Imports []struct {
		Path    string   `mapstructure:"path" json:"path"`
		Goos    []string `mapstructure:"goos" json:"goos"`
		Symbols []string `mapstructure:"symbols" json:"symbols"`
	} `mapstructure:"imports" json:"imports"`
}

// GovulndbAffectedDatabaseSpecific represents the custom data format used by Govulndb for OSV.Affected.DatabaseSpecific
type GovulndbAffectedDatabaseSpecific struct {
	URL string `json:"url"`
}

type Govulndb int64

func (g Govulndb) topLevelHandler(o OSV, v *shared.Vulnerability) error {
	v.DataSource = "https://pkg.go.dev/vuln/" + o.ID

	// Govulndb doesn't provide any top-level database_specific data
	return nil
}

func (g Govulndb) affectedHandler(a OSVAffected, affectedPackage *shared.AffectedPackage) error {
	affectedPackage.Namespace = "govulndb"

	// Attempt to decode the JSON from an interface{} to GovulnDBAffectedEcosystemSpecific
	var es GovulndbAffectedEcosystemSpecific
	if err := mapstructure.Decode(a.EcosystemSpecific, &es); err != nil {
		return errors.Wrap(err, "cannot map DatabaseSpecific to GovulndbAffectedEcosystemSpecific")
	}

	for _, i := range es.Imports {
		affectedPackage.AffectedSymbols = append(affectedPackage.AffectedSymbols, shared.AffectedSymbol{
			Path:    i.Path,
			Symbols: i.Symbols,
		})
	}

	return nil
}
