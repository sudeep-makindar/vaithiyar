import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BASE_API } from '../../config.js';

const DrugInteractionGraph = ({ patient }) => {
  const svgRef = useRef(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [interactions, setInteractions] = useState([]);

  useEffect(() => {
    if (!patient) return;
    
    // Fetch all drug interactions from the backend
    fetch(`${BASE_API}/patient/${patient.id}/interactions`)
      .then(res => res.json())
      .then(data => {
        setInteractions(data);
      })
      .catch(err => console.error("Error fetching drug interactions:", err));
  }, [patient?.id]);

  useEffect(() => {
    if (!patient || !svgRef.current || interactions.length === 0) return;

    // Clear previous SVG
    d3.select(svgRef.current).selectAll('*').remove();

    const activeMeds = patient.medications.map(m => m.name);
    
    // Nodes: patient active medications
    const nodes = activeMeds.map(m => ({ id: m }));
    
    // Edges: interactions where both drugs are in patient medications
    const edges = [];
    interactions.forEach(inter => {
      const matchA = activeMeds.some(m => m.toLowerCase().includes(inter.drug_a.toLowerCase()));
      const matchB = activeMeds.some(m => m.toLowerCase().includes(inter.drug_b.toLowerCase()));
      if (matchA && matchB) {
        const nameA = activeMeds.find(m => m.toLowerCase().includes(inter.drug_a.toLowerCase()));
        const nameB = activeMeds.find(m => m.toLowerCase().includes(inter.drug_b.toLowerCase()));
        
        edges.push({
          source: nameA,
          target: nameB,
          severity: inter.severity,
          desc: inter.desc
        });
      }
    });

    const width = 280;
    const height = 150;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2));

    // Draw lines
    const link = svg.append('g')
      .selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('stroke', d => {
        if (d.severity === 'high' || d.severity === 'critical') return '#ba1a1a'; // brand red
        if (d.severity === 'medium') return '#F5C842'; // brand yellow
        return '#A8D4F5'; // brand blue
      })
      .attr('stroke-width', 2.5)
      .style('stroke-dasharray', d => d.severity === 'high' || d.severity === 'critical' ? 'none' : '4,4')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        setSelectedEdge(d);
      });

    // Draw nodes group
    const node = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
      );

    node.append('circle')
      .attr('r', 16)
      .attr('fill', '#ffffff')
      .attr('stroke', '#1c1b1b')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer');

    node.append('text')
      .text(d => d.id.substring(0, 3).toUpperCase())
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1c1b1b')
      .style('font-family', 'DM Sans')
      .style('font-size', '9px')
      .style('font-weight', '700')
      .style('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

  }, [patient?.id, interactions]);

  return (
    <div className="flex flex-col items-center w-full h-full justify-between">
      
      {/* SVG canvas */}
      <div className="w-full flex justify-center">
        <svg ref={svgRef} className="bg-transparent overflow-visible"></svg>
      </div>
      
      {/* Mini Details Panel */}
      <div className="text-[10px] text-brand-sidebar font-bold text-center w-full px-2 min-h-[38px] flex items-center justify-center bg-white/40 border border-brand-sidebar/10 rounded-xl p-2 mt-2">
        {selectedEdge ? (
          <div>
            <span className="font-extrabold uppercase text-[9px] tracking-wider text-red-650 font-mono block">
              {selectedEdge.source.id} × {selectedEdge.target.id} ({selectedEdge.severity})
            </span>
            <p className="leading-tight text-brand-sidebar/85 font-medium mt-0.5">{selectedEdge.desc}</p>
          </div>
        ) : (
          <span className="opacity-60 font-bold block">Click edge lines to query detailed pharmacological conflicts.</span>
        )}
      </div>
    </div>
  );
};

export default DrugInteractionGraph;
