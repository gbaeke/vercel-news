'use client';

import { useEffect, useId, useState } from 'react';
import type { ArticleDiagramLook } from '../lib/types';

interface DiagramRendererProps {
  source: string;
  look: ArticleDiagramLook;
  label: string;
  className?: string;
}

const LIGHT_THEME = {
  background: '#F4F0E8',
  primaryColor: '#F4F0E8',
  primaryTextColor: '#191713',
  primaryBorderColor: '#191713',
  secondaryColor: '#ECE6D9',
  tertiaryColor: '#F4F0E8',
  lineColor: '#6B6459',
  textColor: '#191713',
  mainBkg: '#F4F0E8',
  nodeBorder: '#191713',
  clusterBkg: '#F4F0E8',
  clusterBorder: '#6B6459',
  edgeLabelBackground: '#F4F0E8',
  actorBkg: '#ECE6D9',
  actorBorder: '#191713',
  actorTextColor: '#191713',
  signalColor: '#6B6459',
  signalTextColor: '#191713',
  noteBkgColor: '#ECE6D9',
  noteBorderColor: '#6B6459',
};

const DARK_THEME = {
  background: '#171310',
  primaryColor: '#171310',
  primaryTextColor: '#EDE7DB',
  primaryBorderColor: '#EDE7DB',
  secondaryColor: '#211C17',
  tertiaryColor: '#171310',
  lineColor: '#97907F',
  textColor: '#EDE7DB',
  mainBkg: '#171310',
  nodeBorder: '#EDE7DB',
  clusterBkg: '#171310',
  clusterBorder: '#97907F',
  edgeLabelBackground: '#171310',
  actorBkg: '#211C17',
  actorBorder: '#EDE7DB',
  actorTextColor: '#EDE7DB',
  signalColor: '#97907F',
  signalTextColor: '#EDE7DB',
  noteBkgColor: '#211C17',
  noteBorderColor: '#97907F',
};

function editorialThemeCss(night: boolean): string {
  const paper = night ? '#171310' : '#F4F0E8';
  const paper2 = night ? '#211C17' : '#ECE6D9';
  const ink = night ? '#EDE7DB' : '#191713';
  const muted = night ? '#97907F' : '#6B6459';
  const accent = night ? '#E0603F' : '#C8361E';
  const accentTint = night ? 'rgba(224, 96, 63, 0.12)' : 'rgba(200, 54, 30, 0.08)';
  const quietFill = night ? 'rgba(237, 231, 219, 0.035)' : 'rgba(25, 23, 19, 0.025)';

  return `
    .nodeLabel, .label, .actor, .actor-man line + text {
      font-family: var(--font-body), Newsreader, Georgia, serif;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.2;
    }
    .edgeLabel, .edgeLabel p, .messageText, .loopText, .noteText {
      font-family: var(--font-mono), "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.025em;
    }
    .cluster-label, .cluster-label span, .cluster-label p {
      font-family: var(--font-mono), "IBM Plex Mono", ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${muted};
      fill: ${muted};
    }
    .node rect, .node polygon, .node circle, .node ellipse, .node path,
    .actor, .labelBox, .note {
      filter: none;
      stroke-width: 1.2px;
    }
    .node rect, .actor, .labelBox, .note { rx: 6px; ry: 6px; }
    .flowchart-link, .messageLine0, .messageLine1 {
      stroke-width: 1.2px;
    }
    .edgeLabel rect, .edgeLabel .labelBkg { fill: ${paper}; opacity: 0.96; }
    .cluster rect {
      fill: ${quietFill};
      stroke: ${muted};
      stroke-width: 0.8px;
      stroke-dasharray: 4 4;
      rx: 8px;
      ry: 8px;
    }
    .node.focal rect, .node.focal polygon, .node.focal circle,
    .node.focal ellipse, .node.focal path {
      fill: ${accentTint};
      stroke: ${accent};
      stroke-width: 2px;
    }
    .node.store rect, .node.store polygon, .node.store path {
      fill: ${paper2};
      stroke: ${muted};
    }
    .node.external rect, .node.external polygon, .node.external circle,
    .node.external ellipse, .node.external path {
      fill: ${quietFill};
      stroke: ${muted};
      stroke-dasharray: 4 3;
    }
    .node.optional rect, .node.optional polygon, .node.optional circle,
    .node.optional ellipse, .node.optional path {
      fill: ${paper};
      stroke: ${muted};
      stroke-dasharray: 4 3;
      opacity: 0.82;
    }
    .actor-line { stroke: ${muted}; stroke-width: 0.8px; stroke-dasharray: 4 4; }
    .messageLine1 { stroke-dasharray: 4 3; }
    marker path { fill: ${muted}; stroke: ${muted}; }
    text, .label, .nodeLabel, .messageText { color: ${ink}; fill: ${ink}; }
  `;
}

export function DiagramRenderer({
  source,
  look,
  label,
  className = '',
}: DiagramRendererProps) {
  const reactId = useId();
  const wide = /^(?:flowchart\s+(?:LR|RL)|sequenceDiagram)\b/i.test(source.trim());
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [night, setNight] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setNight(root.classList.contains('night'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = `article-diagram-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${night ? 'night' : 'day'}`;

    async function renderDiagram() {
      setError('');
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: 12_000,
          maxEdges: 80,
          theme: 'base',
          look,
          handDrawnSeed: 17,
          htmlLabels: false,
          fontFamily: 'var(--font-body), Newsreader, Georgia, serif',
          themeVariables: night ? DARK_THEME : LIGHT_THEME,
          themeCSS: editorialThemeCss(night),
          flowchart: {
            curve: 'rounded',
            diagramPadding: 12,
            nodeSpacing: 38,
            rankSpacing: 54,
            padding: 14,
            wrappingWidth: 170,
          },
          sequence: {
            actorMargin: 64,
            boxMargin: 12,
            diagramMarginX: 24,
            diagramMarginY: 18,
            messageMargin: 30,
            noteMargin: 12,
          },
        });
        const result = await mermaid.render(id, source);
        if (!cancelled) setSvg(result.svg);
      } catch (renderError) {
        console.error('[diagram] Mermaid render failed', renderError);
        if (!cancelled) {
          setSvg('');
          setError('This Mermaid source could not be rendered. Edit the source or regenerate the diagram.');
        }
      }
    }

    void renderDiagram();
    return () => { cancelled = true; };
  }, [source, look, night, reactId]);

  return (
    <div
      className={`article-diagram-renderer${wide ? ' article-diagram-renderer--wide' : ''} ${className}`.trim()}
      role="img"
      aria-label={label}
      tabIndex={wide ? 0 : undefined}
    >
      {wide && <span className="article-diagram-scroll-hint" aria-hidden="true">Swipe to explore →</span>}
      {error ? (
        <p className="article-diagram-error">{error}</p>
      ) : svg ? (
        <div
          className="article-diagram-svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="article-diagram-loading">Rendering diagram…</p>
      )}
    </div>
  );
}
