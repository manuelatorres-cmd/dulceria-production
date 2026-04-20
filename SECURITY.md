# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Dulceria, please report it privately via email:

**manuela.torres@dulceria-gmbh.com**

Please include:
- A description of the vulnerability
- Steps to reproduce it
- Any relevant screenshots or logs

## What NOT to do

- Do not open a public GitHub issue for security vulnerabilities
- Do not post details in any public channel

## Scope

Dulceria is Dulceria GmbH's internal production planning system, forked from the open-source Choc-collab app and extended with a Supabase backend. Security-relevant concerns include:

- XSS or injection vulnerabilities in the client
- Issues with the service worker or CSP configuration
- Sensitive data leaking into the bundle or logs
- Vulnerabilities in dependencies
- Supabase RLS gaps that would expose data to unauthenticated callers

Thank you for helping keep Dulceria safe.
