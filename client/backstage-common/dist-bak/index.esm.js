import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { parseEntityYaml } from '@backstage/plugin-catalog-backend';
import { gql, GraphQLClient } from 'graphql-request';
import { currentAuthStateQuery } from '@sourcegraph/shared/src/auth';

const parseCatalog = (src, providerName) => {
  const results = [];
  src.forEach((r) => {
    const location = {
      "type": "url",
      "target": `${r.repository}/catalog-info.yaml`
    };
    const yaml = Buffer.from(r.fileContent, "utf8");
    for (const item of parseEntityYaml(yaml, location)) {
      const parsed = item;
      results.push({
        entity: {
          ...parsed.entity,
          metadata: {
            ...parsed.entity.metadata,
            annotations: {
              ...parsed.entity.metadata.annotations,
              [ANNOTATION_LOCATION]: `url:${parsed.location.target}`,
              [ANNOTATION_ORIGIN_LOCATION]: providerName
            }
          }
        },
        locationKey: parsed.location.target
      });
    }
  });
  return results;
};

class SearchQuery {
  constructor(query) {
    this.query = query;
  }
  Marshal(data) {
    const results = new Array();
    for (let v in data.search.results.results) {
      let {
        repository,
        file: { fileContent }
      } = v;
      results.push({ repository, fileContent });
    }
    return results;
  }
  vars() {
    return { search: this.query };
  }
  gql() {
    return gql`
      query ($search: String!) {
        search(query: $search) {
          results {
            __typename
            ... on FileMatch {
              repository
            }
            file {
              content
            }
          }
        }
      }
    `;
  }
}
class UserQuery {
  Marshal(data) {
    if ("currentUser" in data) {
      return [data.currentUser.username];
    }
    throw new Error("username not found");
  }
  vars() {
    return "";
  }
  gql() {
    return gql`
    query {
      currentUser {
        username
      }
    }
    `;
  }
}
class AuthenticatedUserQuery {
  gql() {
    return currentAuthStateQuery;
  }
  vars() {
    return "";
  }
  Marshal(data) {
    return [data.currentUser];
  }
}

const createService = (config) => {
  const { endpoint, token, sudoUsername } = config;
  const base = new BaseClient(endpoint, token, sudoUsername || "");
  return new SourcegraphClient(base);
};
class SourcegraphClient {
  constructor(client) {
    this.Users = this;
    this.Search = this;
    this.client = client;
  }
  async SearchQuery(query) {
    const q = new SearchQuery(query);
    const data = await this.client.fetch(q);
    return q.Marshal(data);
  }
  async CurrentUsername() {
    const q = new UserQuery();
    const data = await this.client.fetch(q);
    return data[0];
  }
  async GetAuthenticatedUser() {
    const q = new AuthenticatedUserQuery();
    const data = await this.client.fetch(q);
    return data[0];
  }
}
class BaseClient {
  constructor(baseUrl, token, sudoUsername) {
    const authz = (sudoUsername == null ? void 0 : sudoUsername.length) > 0 ? `token-sudo user="${sudoUsername}",token="${token}"` : `token ${token}`;
    const apiUrl = `${baseUrl}/.api/graphql`;
    this.client = new GraphQLClient(
      apiUrl,
      {
        headers: {
          "X-Requested-With": `Sourcegraph - Backstage plugin DEV`,
          Authorization: authz
        }
      }
    );
  }
  async fetch(q) {
    const data = await this.client.request(q.gql(), q.vars());
    return q.Marshal(data);
  }
}

class SourcegraphEntityProvider {
  static create(config) {
    return new SourcegraphEntityProvider(config);
  }
  constructor(config) {
    const endpoint = config.getString("sourcegraph.endpoint");
    const token = config.getString("sourcegraph.token");
    const sudoUsername = config.getOptionalString("sourcegraph.sudoUsername");
    this.sourcegraph = createService({ endpoint, token, sudoUsername });
  }
  getProviderName() {
    return "sourcegraph-entity-provider";
  }
  async connect(connection) {
    this.connection = connection;
  }
  async fullMutation() {
    var _a;
    const results = await this.sourcegraph.Search.SearchQuery(`"file:^catalog-info.yaml$"`);
    const entities = parseCatalog(results, this.getProviderName());
    await ((_a = this.connection) == null ? void 0 : _a.applyMutation({
      type: "full",
      entities
    }));
  }
}

console.log("HELLO");

export { AuthenticatedUserQuery, SearchQuery, SourcegraphEntityProvider, UserQuery, createService, parseCatalog };
//# sourceMappingURL=index.esm.js.map
