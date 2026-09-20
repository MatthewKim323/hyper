# Hyper MCP

Investigate your accounts-payable data from Claude Code, Codex, or any MCP client.

Read-only. Every tool calls the product's own API with your token, so it sees exactly what
you see and nothing more. Posting to the ledger, approving a payable and verifying a record
are owner actions in the product and are not exposed here at all.

## Install

```sh
claude mcp add hyper --env HYPER_TOKEN=<your token> -- npx -y @hyper/mcp
```

Get the token from **Access → Agent access** in your workspace at
[hyper.stephenhung.me](https://hyper.stephenhung.me).

<details>
<summary>Other clients</summary>

```json
{
  "mcpServers": {
    "hyper": {
      "command": "npx",
      "args": ["-y", "@hyper/mcp"],
      "env": { "HYPER_TOKEN": "<your token>" }
    }
  }
}
```

</details>

## Tools

| Tool | What it answers |
| --- | --- |
| `hyper_list_datasets` | What evidence exists at all. Start here. |
| `hyper_query_financials` | An exact number over a complete population. |
| `hyper_search_evidence` | Cited passages from source documents. |
| `hyper_get_source` | The original content behind a citation. |
| `hyper_list_payable_cases` | Open AP cases with recomputed amounts. |
| `hyper_analyze_payable` | Three-way match and every blocking issue for one case. |
| `hyper_ap_aging` | Unresolved residual bucketed by age, per currency. |
| `hyper_list_anomalies` | Evidence-backed outliers. |
| `hyper_list_proposals` | Payable proposals and their approval standing. |
| `hyper_trial_balance` | Debits, credits and the balance check. |
| `hyper_workspace` | Which organization you are connected to. |

## Two things worth telling your agent

Amounts come from a deterministic engine, not from a model. `hyper_analyze_payable` returns
what the records support and why, so treat its numbers as the answer rather than
recalculating them.

`hyper_search_evidence` returns **samples**. For any figure you intend to quote, use
`hyper_query_financials`, which runs over the complete population.
