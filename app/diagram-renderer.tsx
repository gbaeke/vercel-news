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
  primaryColor: '#ECE6D9',
  primaryTextColor: '#191713',
  primaryBorderColor: '#191713',
  secondaryColor: '#F4F0E8',
  tertiaryColor: '#F4F0E8',
  lineColor: '#6B6459',
  textColor: '#191713',
  mainBkg: '#ECE6D9',
  nodeBorder: '#191713',
  clusterBkg: '#F4F0E8',
  clusterBorder: '#6B6459',
  edgeLabelBackground: '#F4F0E8',
  actorBkg: '#ECE6D9',
  actorBorder: '#191713',
  actorTextColor: '#191713',
  signalColor: '#C8361E',
  signalTextColor: '#191713',
  noteBkgColor: '#ECE6D9',
  noteBorderColor: '#C8361E',
};

const DARK_THEME = {
  background: '#171310',
  primaryColor: '#211C17',
  primaryTextColor: '#EDE7DB',
  primaryBorderColor: '#EDE7DB',
  secondaryColor: '#171310',
  tertiaryColor: '#171310',
  lineColor: '#97907F',
  textColor: '#EDE7DB',
  mainBkg: '#211C17',
  nodeBorder: '#EDE7DB',
  clusterBkg: '#171310',
  clusterBorder: '#97907F',
  edgeLabelBackground: '#171310',
  actorBkg: '#211C17',
  actorBorder: '#EDE7DB',
  actorTextColor: '#EDE7DB',
  signalColor: '#E0603F',
  signalTextColor: '#EDE7DB',
  noteBkgColor: '#211C17',
  noteBorderColor: '#E0603F',
};

export function DiagramRenderer({
  source,
  look,
  label,
  className = '',
}: DiagramRendererProps) {
  const reactId = useId();
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
          fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
          themeVariables: night ? DARK_THEME : LIGHT_THEME,
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
    <div className={`article-diagram-renderer ${className}`.trim()} role="img" aria-label={label}>
      {error ? (
        <p className="article-diagram-error">{error}</p>
      ) : svg ? (
        <div className="article-diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="article-diagram-loading">Rendering diagram…</p>
      )}
    </div>
  );
}
