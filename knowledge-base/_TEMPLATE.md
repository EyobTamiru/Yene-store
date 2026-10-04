---
id: example-article
title: Replace this with a real article title
category: platform
status: draft
audience: all
lastReviewed: 2026-09-27
reviewedBy: unassigned
requiresAccountData: false
keywords:
  - example
  - template
  - how to write an article
related: []
---

TODO(content-owner): Replace this body with the real answer, then set
`status: published` above.

## House rules for writing an article

1. **Write only what is officially true.** If you would not put it in a
   printed manual signed off by Yene Business Group, do not approve it.
2. **Never write a price** unless it is the officially published figure. For a
   quotation, point the customer to Yene Business Group.
3. **Use the real UI labels** in step-by-step instructions, so a customer can
   follow them exactly.
4. **Write the words a customer would actually type** in `keywords`, including
   synonyms and local phrasing. Retrieval is keyword based.
5. **One topic per file.** Link neighbours with `related`.

## Suggested structure

A short direct answer first, then detail:

> Yene-Store does X. Here is how it works:
>
> 1. First step
> 2. Second step
>
> If you need Y, contact a support agent.

## Frontmatter fields

| field | required | notes |
| --- | --- | --- |
| `id` | yes | lowercase-kebab-case |
| filename | yes | **must be exactly `<id>.md`** - the loader rejects any other name |
| `title` | yes | |
| `category` | yes | must be one of the registered categories |
| `status` | yes | `approved` or `draft` |
| `audience` | yes | `customer`, `business-owner`, `employee`, `all` |
| `lastReviewed` | yes | `YYYY-MM-DD` |
| `reviewedBy` | yes | who signed it off |
| `requiresAccountData` | no | `true` for live values (price, order state, stock) |
| `keywords` | yes | at least one |
| `related` | no | ids of neighbouring articles |

## Available categories

getting-started, company, features, account, package, pricing, policy, store,
promotions, orders, customers, inventory, analytics, business-management,
billing, faq, tutorial, troubleshooting, support
