---
name: Cybernetic Command
colors:
  surface: '#111416'
  surface-dim: '#111416'
  surface-bright: '#37393c'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#191c1e'
  surface-container: '#1d2022'
  surface-container-high: '#282a2d'
  surface-container-highest: '#323538'
  on-surface: '#e1e2e6'
  on-surface-variant: '#c1c7cf'
  inverse-surface: '#e1e2e6'
  inverse-on-surface: '#2e3133'
  outline: '#8b9199'
  outline-variant: '#41484e'
  surface-tint: '#95cdf8'
  primary: '#95cdf8'
  on-primary: '#00344e'
  primary-container: '#5e97bf'
  on-primary-container: '#002d44'
  inverse-primary: '#256489'
  secondary: '#b4c9dd'
  on-secondary: '#1e3242'
  secondary-container: '#384b5c'
  on-secondary-container: '#a6bbce'
  tertiary: '#d8c3af'
  on-tertiary: '#3b2e20'
  tertiary-container: '#a08e7b'
  on-tertiary-container: '#34271a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c9e6ff'
  primary-fixed-dim: '#95cdf8'
  on-primary-fixed: '#001e2f'
  on-primary-fixed-variant: '#004b6f'
  secondary-fixed: '#d0e5fa'
  secondary-fixed-dim: '#b4c9dd'
  on-secondary-fixed: '#071d2c'
  on-secondary-fixed-variant: '#354959'
  tertiary-fixed: '#f5dfca'
  tertiary-fixed-dim: '#d8c3af'
  on-tertiary-fixed: '#24190d'
  on-tertiary-fixed-variant: '#534435'
  background: '#111416'
  on-background: '#e1e2e6'
  surface-variant: '#323538'
typography:
  metric-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  metric-md:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  label-caps:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.15em
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 12px
  margin-mobile: 16px
  margin-desktop: 32px
---

# Cybernetic Command Design System

## Brand & Style

The design system is engineered for high-stakes operational environments, prioritizing rapid data ingestion and technical precision. The aesthetic is **Technical Minimalist**, drawing inspiration from heavy industrial interfaces, naval consoles, and advanced developer tooling. It evokes a sense of calm authority and field-readiness through high-density layouts and a restrained, functional color palette.

The visual language avoids app-like softness, opting instead for an **instrument-cluster** feel. Key characteristics include high-contrast data points, tonal layering to define hierarchy without physical shadows, and purposeful use of subtle glows to indicate active states or signal flow. The updated palette reinforces a mature, maritime-industrial aesthetic with a focus on desaturated, utilitarian tones.

## Colors

The palette is built on a deep operational foundation of muted slates and industrial greys to minimize eye strain during extended monitoring.

### Primary — Steel Blue

Used for interactive elements, focus states, and primary data paths. It provides a professional, stable focal point against the dark background.

### Secondary — Cool Slate

Reserved for secondary actions, structural accents, and auxiliary system metrics.

### Tertiary — Sandstone

A muted, warm neutral used for auxiliary data highlights, historical markers, or secondary status indicators that require distinction without the urgency of an alert.

### Neutrals

A range of medium-to-dark greys used for tonal layering, including Surface 1, Surface 2, Surface 3, and muted borders.

### Accents

Subtle **Signal Glows** are implemented using low-opacity versions of the primary Steel Blue to indicate active data rails or radial indicators.

## Typography

Typography is treated as a functional readout. **Geist** provides a clean, geometric structure that remains legible at small sizes.

### Metrics

Primary data points use bold, slightly condensed weights to maximize horizontal space.

### Labels

All functional labels use `label-caps` with significant letter-spacing to distinguish them from content and provide a professional, technical HUD-style aesthetic.

### Technical Data

Use monospaced fonts for logs, coordinates, and timestamp values to ensure character alignment in dense tables.

## Layout & Spacing

This design system utilizes a **4px baseline grid** to achieve high information density. The layout philosophy is a **Module-Based Fluid Grid**.

### Density

Elements are packed more tightly than consumer-facing apps to ensure more data is visible above the fold.

### Structure

Content is organized into **Signal Rails**: vertical or horizontal logical groupings separated by thin, muted dividers rather than heavy cards.

### Adaptive Rules

On desktop, a 12-column grid is used with narrow 12px gutters. On mobile, the layout collapses into a single-column stack, prioritizing **Critical Metrics** at the top of the viewport.

## Elevation & Depth

Depth is conveyed through **Tonal Layering** rather than shadows.

### Surface 0 — Background

The darkest neutral grey or slate base.

### Surface 1 — Containers

Slightly lighter neutral tones used to group related modules.

### Borders

Instead of shadows, use 1px solid borders in a muted neutral slate. For active modules, the border color may shift to a low-opacity Primary Steel Blue.

### Signal Glows

Active indicators and graphical elements, such as radial progress rings, use a 4–8px outer glow with the primary or secondary color at 20–30% opacity to simulate an emissive display.

## Shapes

Shapes are disciplined and industrial. A soft rounding of `0.25rem` is applied to buttons and primary containers to prevent the UI from feeling overly aggressive, while still remaining sharp enough to look technical.

### Status Indicators

Small circular pips for live status.

### Progress Rails

Linear bars with flat ends or minimal 2px rounding.

### Data Tags

Rectangular with sharp 2px corners, reinforcing the field-ready terminal look.

## Components

### Buttons

Ghost-style by default with a 1px border. Primary buttons feature a solid Steel Blue fill with high-contrast text for visibility. Active states include a subtle interior glow.

### Chips / Tags

Small monospaced text within a low-contrast neutral background. System-specific tags, such as `ARCHIVED`, use a tertiary Sandstone border for subtle visual distinction.

### Inputs

Terminal-style inputs. Use a bottom-only border that glows Steel Blue when focused. Labels are always positioned above the input in `label-caps`.

### Data Metrics

A combination of a large bold metric value, a `label-caps` title, and a small Signal Rail, such as a tiny sparkline or status bar, beneath it.

### Signal Rails

Vertical dividers that indicate a logical connection between different modules or steps in a process, often accented with a 1px primary-color line.

### Cards / Modules

Avoid traditional cards. Use **Modules** defined by a Surface 1 background and a 1px muted border. Do not use box shadows.
