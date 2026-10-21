import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { usePatientStore } from '../stores/patientStore';
import useSSEStream from '../hooks/useSSEStream';
import TopHeader from '../components/TopHeader';
import StreamingText from '../components/ui/StreamingText';
import CalendarSidebar from '../components/CalendarSidebar';
import { BASE_API } from '../config.js';

const ComorbidityWeb = () => {
  const { patients, currentPatient, setCurrentPatient } = usePatientStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [comorbidityData, setComorbidityData] = useState(null);

  // SSE Streams
  const webSSE = useSSEStream();
  const opinionSSE = useSSEStream();
  const nodeSSE = useSSEStream();

  const svgRef = useRef(null);
  
  // State for Second Opinion Engine
  const [hypothesis, setHypothesis] = useState('');
  const [opinionResult, setOpinionResult] = useState(null);
  const [activeNode, setActiveNode] = useState(null);

  // Filter patients by search
  const filteredPatients = patients.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const loadComorbidityWeb = async (patientId) => {
    setComorbidityData(null);
    setActiveNode(null);
    setOpinionResult(null);
    setHypothesis('');
    
    try {
      webSSE.setData('');
      await webSSE.startStream(`${BASE_API}/comorbidity/web`, { patient_id: patientId });
    } catch (err) {
      console.error("Failed to load comorbidity web:", err);
    }
  };

  useEffect(() => {
    if (currentPatient) {
      setSearchTerm(currentPatient.name);
      loadComorbidityWeb(currentPatient.id);
    }
  }, [currentPatient?.id]);

  // Parse Comorbidity Web data when stream updates
  useEffect(() => {
    if (webSSE.data && !webSSE.loading) {
      try {
        let cleanText = webSSE.data.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.substring(0, cleanText.length - 3);
        }
        const parsed = JSON.parse(cleanText.trim());
        setComorbidityData(parsed);
      } catch (e) {
        // Wait for complete stream
      }
    }
  }, [webSSE.data, webSSE.loading]);

  // D3 Graph Rendering (Redesigned matching ComorbidityNetwork.html mockup)
  useEffect(() => {
    if (!comorbidityData || !svgRef.current) return;

    d3.select(svgRef.current).selectAll('*').remove();

    const nodes = comorbidityData.nodes.map(d => ({ ...d }));
    const links = comorbidityData.edges.map(d => ({ ...d }));

    const width = 600;
    const height = 420;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g');

    // Zoom and pan
    svg.call(d3.zoom()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      })
    );

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(130))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2));

    // Links: curved lines
    const link = g.append('g')
      .selectAll('path')
      .data(links)
      .enter()
      .append('path')
      .attr('stroke', d => d.direction === 'amplifying' ? '#F7A8C4' : '#A8D4F5') // Light pink/blue link borders
      .attr('stroke-width', d => d.strength * 3)
      .attr('fill', 'none')
      .attr('opacity', 0.8)
      .style('cursor', 'pointer');

    // Nodes: Groups with rects and texts inside
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
      )
      .style('cursor', 'pointer')
      .on('click', async (event, d) => {
        setActiveNode(d);
        nodeSSE.setData('');
        try {
          await nodeSSE.startStream(`${BASE_API}/query`, {
            patient_id: currentPatient.id,
            query: `Describe the role of condition \"${d.condition}\" (ICD: ${d.icd_code}) for this patient. Give a 3-sentence clinical breakdown explaining its severity (${d.severity}) and potential complications.`
          });
        } catch (err) {
          console.error(err);
        }
      });

    // Node rect shape
    node.append('rect')
      .attr('width', 100)
      .attr('height', 36)
      .attr('x', -50)
      .attr('y', -18)
      .attr('rx', 12)
      .attr('ry', 12)
      .attr('fill', d => d.severity > 0.6 ? '#F7A8C4' : d.severity > 0.3 ? '#F5C842' : '#B5C43A') // Pink, yellow, green mapping
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2.5)
      .style('filter', 'drop-shadow(0 4px 6px rgba(0,0,0,0.06))');

    // Node Text label
    node.append('text')
      .text(d => d.condition)
      .attr('text-anchor', 'middle')
      .attr('y', 5)
      .attr('fill', '#1B1C1A')
      .style('font-family', 'DM Sans')
      .style('font-size', '10px')
      .style('font-weight', '800');

    simulation.on('tick', () => {
      link.attr('d', d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });

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

  }, [comorbidityData]);

  // Execute Second Opinion hypothesis validation
  const handleExecuteValidation = async (e) => {
    e.preventDefault();
    if (!hypothesis.trim()) return;

    setOpinionResult({
      verdict: 'PENDING',
      confidence: 0,
      chain: ''
    });

    try {
      opinionSSE.setData('');
      opinionSSE.setLoading(true);
      await opinionSSE.startStream(`${BASE_API}/second-opinion`, {
        patient_id: currentPatient.id,
        hypothesis: hypothesis
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Parse Opinion Result as stream aggregates
  useEffect(() => {
    if (opinionSSE.data) {
      const fullText = opinionSSE.data;
      const firstLine = fullText.split('\n')[0];
      
      let verdict = 'ANALYZING';
      let confidence = 50;
      let chain = fullText;

      if (firstLine.startsWith('[VERDICT:')) {
        const parts = firstLine.replace('[', '').replace(']', '').split('|');
        for (const p of parts) {
          if (p.includes('VERDICT:')) verdict = p.split(':')[1].trim();
          if (p.includes('CONFIDENCE:')) confidence = parseInt(p.split(':')[1].trim()) || 50;
        }
        chain = fullText.split('\n').slice(1).join('\n').trim();
      }

      setOpinionResult({
        verdict,
        confidence,
        chain
      });
    }
  }, [opinionSSE.data]);

  return (
    <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
      <TopHeader />
      
      <main className="px-4 md:px-8 pb-8 flex-grow flex flex-col lg:flex-row gap-6 w-full max-w-[1500px] mx-auto relative">
        {/* Left Column (60% width comorbidity force graph) */}
        <div className="flex-grow lg:flex-[6] flex flex-col min-w-0">
          <div className="mb-6">
            <h2 className="text-2xl md:text-3xl font-extrabold text-brand-sidebar tracking-tight">Comorbidity network:</h2>
            <p className="text-sm text-gray-500 font-medium mt-1">Interactive graph of interconnected chronic conditions and risk factors.</p>
          </div>

          {webSSE.loading ? (
            <div className="flex items-center justify-center p-20 bg-white border border-gray-200 rounded-card shadow-sm">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-4 border-brand-pink border-t-transparent rounded-full animate-spin mb-4"></div>
                <div className="text-brand-pink font-extrabold tracking-wider">MAPPING COMORBIDITY EDGES...</div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200/80 rounded-2xl flex-1 relative overflow-hidden flex flex-col p-4 min-h-[350px] lg:min-h-[480px]">
              {/* Toolbox labels */}
              <div className="absolute top-4 left-4 z-10 flex gap-2">
                <span className="bg-gray-100 px-3 py-1.5 rounded-full text-[10px] font-bold text-gray-700 flex items-center gap-1.5 border border-gray-200">
                  <span className="w-2 h-2 rounded-full bg-[#B5C43A]"></span> Stable
                </span>
                <span className="bg-gray-100 px-3 py-1.5 rounded-full text-[10px] font-bold text-gray-700 flex items-center gap-1.5 border border-gray-200">
                  <span className="w-2 h-2 rounded-full bg-[#F5C842]"></span> Monitor
                </span>
                <span className="bg-gray-100 px-3 py-1.5 rounded-full text-[10px] font-bold text-gray-700 flex items-center gap-1.5 border border-gray-200">
                  <span className="w-2 h-2 rounded-full bg-[#F7A8C4]"></span> Critical
                </span>
              </div>

              {/* D3 SVG Container */}
              <div className="flex-1 w-full h-full flex items-center justify-center">
                <svg ref={svgRef} className="w-full h-full"></svg>
              </div>
            </div>
          )}
        </div>

        {/* Center Column: Details Cards (40% width) */}
        <div className="flex-grow lg:flex-[4] flex flex-col gap-6 w-full lg:max-w-[480px]">
          <div className="hidden lg:block h-10 shrink-0"></div>

          {/* Condition Details Card (Yellow) */}
          <div className="bg-[#F5C842] rounded-2xl p-6 relative overflow-hidden flex-1 flex flex-col shadow-sm min-h-[220px]">
            <div className="blob-bg blob-yellow opacity-30"></div>
            <div className="card-content flex-1 flex flex-col z-10">
              <h3 className="font-extrabold text-xl text-brand-sidebar mb-6">Condition details:</h3>
              
              {activeNode ? (
                <>
                  <div className="bg-white/60 rounded-xl p-4 mb-4 border border-white/20">
                    <div className="flex items-center gap-2 mb-2 text-brand-sidebar font-extrabold text-[10px] uppercase tracking-wider">
                      <span className="material-symbols-outlined text-sm">vital_signs</span>
                      Selected Node
                    </div>
                    <p className="font-extrabold text-base text-brand-sidebar">{activeNode.condition}</p>
                  </div>
                  <div className="bg-white/80 rounded-xl p-4 flex-1 border border-white/40 overflow-y-auto">
                    <div className="flex items-center gap-2 mb-3 text-brand-sidebar font-extrabold text-[10px] uppercase tracking-wider">
                      <span className="material-symbols-outlined text-sm fill-icon text-brand-sidebar">auto_awesome</span>
                      AI Synthesis
                    </div>
                    <p className="text-xs font-semibold text-brand-sidebar/90 leading-relaxed">
                      {nodeSSE.data || 'Analysing comorbidity feedback loop parameters...'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="bg-white/80 rounded-xl p-6 flex-1 flex flex-col items-center justify-center text-center text-gray-500 border border-white/40">
                  <span className="text-2xl mb-2">📊</span>
                  <span className="text-xs font-bold text-brand-sidebar">Select comorbidity web node</span>
                  <span className="text-[10px] mt-1">Click nodes in the network web diagram to load AI pathogenic analysis and ICD mapping.</span>
                </div>
              )}
            </div>
          </div>

          {/* Second Opinion Card (Blue) */}
          <div className="bg-[#A8D4F5] rounded-2xl p-6 relative overflow-hidden flex-1 flex flex-col shadow-sm min-h-[220px]">
            <div className="blob-bg blob-blue opacity-30"></div>
            <div className="card-content flex-1 flex flex-col z-10">
              <h3 className="font-extrabold text-xl text-brand-sidebar mb-2">Second opinion engine:</h3>
              <p className="text-xs text-brand-sidebar/85 font-semibold mb-6">Query the clinical literature database against this comorbidity cluster.</p>
              
              <div className="mt-auto">
                <form onSubmit={handleExecuteValidation} className="relative flex items-center bg-white rounded-full p-1 shadow-sm border border-gray-200">
                  <span className="material-symbols-outlined absolute left-4 text-gray-400">search</span>
                  <input 
                    type="text" 
                    placeholder="e.g., neuropathy interventions..." 
                    value={hypothesis}
                    onChange={(e) => setHypothesis(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 pl-12 pr-4 text-xs font-bold text-brand-sidebar placeholder:text-gray-400"
                  />
                  <button 
                    type="submit"
                    disabled={opinionSSE.loading || !hypothesis.trim()}
                    className="bg-black text-white rounded-full px-6 py-2.5 text-xs font-bold hover:bg-gray-800 transition-colors shrink-0 cursor-pointer"
                  >
                    {opinionSSE.loading ? '...' : 'Execute'}
                  </button>
                </form>
              </div>

              {opinionResult && (
                <div className="mt-4 bg-white/80 rounded-xl p-3 border border-white/40 text-[10px] font-semibold text-brand-sidebar max-h-36 overflow-y-auto custom-scrollbar">
                  <span className="font-extrabold text-brand-pink block mb-1">VERDICT: {opinionResult.verdict} ({opinionResult.confidence}% confidence)</span>
                  {opinionResult.chain}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side Calendar sidebar */}
        <CalendarSidebar />
      </main>
    </div>
  );
};

export default ComorbidityWeb;
