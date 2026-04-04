import FitParser from 'fit-file-parser';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import JSZip from 'jszip';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

Chart.register(...registerables, zoomPlugin);

let currentSmoothing = 3;
let isDarkMode = true;
let labels = [];

function toggleDarkMode() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('light-mode', !isDarkMode);
  localStorage.setItem('darkMode', isDarkMode);
  Object.values(charts).forEach(chart => chart.update('none'));
}

function initTheme() {
  const saved = localStorage.getItem('darkMode');
  if (saved !== null) {
    isDarkMode = saved === 'true';
  }
  document.body.classList.toggle('light-mode', !isDarkMode);
}

initTheme();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/fit-analyzer/sw.js');
}

const fileTabs = {};
let activeTabId = null;
let fitData = null;
let tabCounter = 0;
const charts = {};

function showError(msg) {
  const container = document.getElementById('errorContainer');
  container.innerHTML = `<div class="error">${msg}</div>`;
}

function clearError() {
  document.getElementById('errorContainer').innerHTML = '';
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function parseFitFile(file) {
  const buffer = await file.arrayBuffer();
  
  const fitParser = new FitParser({
    force: true,
    speedUnit: 'km/h',
    lengthUnit: 'km',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'cascade'
  });

  return new Promise((resolve, reject) => {
    fitParser.parse(buffer, (error, data) => {
      if (error) {
        reject(error);
      } else {

        resolve(data);
      }
    });
  });
}

function extractRecordData(data) {
  let records = [];
  
  if (data.records && data.records.length > 0) {
    records = data.records;
  } else if (data.activity) {
    if (data.activity.sessions) {
      for (const session of data.activity.sessions) {
        if (session.laps) {
          for (const lap of session.laps) {
            if (lap.records) {
              records = records.concat(lap.records);
            }
          }
        }
      }
    }
  } else if (data.sessions) {
    for (const session of data.sessions) {
      if (session.laps) {
        for (const lap of session.laps) {
          if (lap.records) {
            records = records.concat(lap.records);
          }
        }
      }
    }
  } else if (data.laps) {
    for (const lap of data.laps) {
      if (lap.records) {
        records = records.concat(lap.records);
      }
    }
  }
  
  const result = {
    timestamps: [],
    speed: [],
    cadence: [],
    heartRate: [],
    power: [],
    leftPower: [],
    rightPower: [],
    leftRightBalance: [],
    altitude: [],
    distance: [],
    temperature: [],
    leftTorqueEffectiveness: [],
    rightTorqueEffectiveness: [],
    leftPedalSmoothness: [],
    rightPedalSmoothness: [],
    strideLength: [],
    groundContactTime: [],
    flightTime: [],
    verticalRatio: [],
    verticalOscillation: [],
    gpsLat: [],
    gpsLong: []
  };

  for (const record of records) {
    if (record.timestamp) {
      result.timestamps.push(new Date(record.timestamp));
    } else if (record.date) {
      result.timestamps.push(new Date(record.date));
    } else if (record.elapsedTimestamp) {
      result.timestamps.push(new Date(record.elapsedTimestamp));
    }
    
    result.speed.push(record.speed ?? record.enhanced_speed ?? record.speedEnhanced ?? null);
    result.cadence.push(record.cadence ?? record.enhanced_cadence ?? null);
    result.heartRate.push(record.heart_rate ?? record.heartRate ?? null);
    result.power.push(record.power ?? null);
    const alt = record.altitude ?? record.enhanced_altitude ?? record.gpsAltitude ?? null;
    result.altitude.push(alt !== null ? alt * 1000 : null);
    result.distance.push(record.distance ?? record.enhanced_distance ?? null);
    result.temperature.push(record.temperature ?? null);
    result.leftTorqueEffectiveness.push(record.left_torque_effectiveness ?? record.leftTorqueEffectiveness ?? null);
    result.rightTorqueEffectiveness.push(record.right_torque_effectiveness ?? record.rightTorqueEffectiveness ?? null);
    result.leftPedalSmoothness.push(record.left_pedal_smoothness ?? record.leftPedalSmoothness ?? null);
    result.rightPedalSmoothness.push(record.right_pedal_smoothness ?? record.rightPedalSmoothness ?? null);
    result.strideLength.push(record.stride_length ?? record.strideLength ?? null);
    result.groundContactTime.push(record.ground_contact_time ?? record.groundContactTime ?? null);
    result.flightTime.push(record.flight_time ?? record.flightTime ?? null);
    result.verticalRatio.push(record.vertical_ratio ?? record.verticalRatio ?? null);
    result.verticalOscillation.push(record.vertical_oscillation ?? record.verticalOscillation ?? null);
    
    const lat = record.position_lat ?? record.gps_lat ?? record.latitude;
    const lon = record.position_long ?? record.gps_long ?? record.longitude;
    result.gpsLat.push(lat !== undefined && lat !== null ? lat : null);
    result.gpsLong.push(lon !== undefined && lon !== null ? lon : null);
    
    let leftPct = null;
    const totalPower = record.power;
    
    const lb = record.left_right_balance ?? record.leftRightBalance;
    if (lb !== undefined && lb !== null) {
      if (typeof lb === 'object' && lb.value !== undefined) {
        if (lb.right) {
          leftPct = 100 - lb.value;
        } else {
          leftPct = lb.value;
        }
      } else if (typeof lb === 'number') {
        if (lb <= 127) {
          leftPct = (lb / 127) * 100;
        } else {
          leftPct = ((255 - lb) / 127) * 100;
        }
      }
    }
    
    const balance = leftPct !== null ? leftPct - 50 : null;
    result.leftRightBalance.push(balance !== null ? Math.round(balance * 10) / 10 : null);
    
    if (leftPct !== null && totalPower !== null && totalPower !== undefined) {
      result.leftPower.push(Math.round(totalPower * leftPct / 100));
      result.rightPower.push(Math.round(totalPower * (100 - leftPct) / 100));
    } else {
      result.leftPower.push(null);
      result.rightPower.push(null);
    }
  }

  return result;
}

function calculateStats(data, session = null) {
  const stats = {};
  
  const validSpeed = data.speed.filter(v => v !== null && v !== undefined);
  const validCadence = data.cadence.filter(v => v !== null && v !== undefined);
  const validHR = data.heartRate.filter(v => v !== null && v !== undefined);
  const validPower = data.power.filter(v => v !== null && v !== undefined);
  const validDistance = data.distance.filter(v => v !== null && v !== undefined);

  if (validSpeed.length > 0) {
    stats.maxSpeed = Math.max(...validSpeed).toFixed(1);
    stats.avgSpeed = (validSpeed.reduce((a, b) => a + b, 0) / validSpeed.length).toFixed(1);
  }

  if (validCadence.length > 0) {
    stats.maxCadence = Math.max(...validCadence);
    stats.avgCadence = Math.round(validCadence.reduce((a, b) => a + b, 0) / validCadence.length);
  }

  if (validHR.length > 0) {
    stats.maxHR = Math.max(...validHR);
    stats.avgHR = Math.round(validHR.reduce((a, b) => a + b, 0) / validHR.length);
  }

  if (validPower.length > 0) {
    stats.maxPower = Math.max(...validPower);
    stats.avgPower = Math.round(validPower.reduce((a, b) => a + b, 0) / validPower.length);
    stats.normalizedPower = calculateNP(validPower);
  }

  if (data.timestamps.length > 1) {
    const firstValid = data.timestamps.find(t => t instanceof Date && !isNaN(t));
    const lastValid = [...data.timestamps].reverse().find(t => t instanceof Date && !isNaN(t));
    if (firstValid && lastValid) {
      const duration = (lastValid - firstValid) / 1000;
      stats.duration = formatDuration(duration);
    }
  }

  if (validDistance.length > 0) {
    const maxDist = Math.max(...validDistance);
    stats.totalDistance = maxDist.toFixed(2);
  }

  if (session) {
    stats.leftRightBalance = session.leftRightBalance?.toFixed(1);
    stats.leftPedalSmoothness = session.leftPedalSmoothness?.toFixed(1);
    stats.rightPedalSmoothness = session.rightPedalSmoothness?.toFixed(1);
    stats.leftTorqueEffectiveness = session.leftTorqueEffectiveness?.toFixed(1);
    stats.rightTorqueEffectiveness = session.rightTorqueEffectiveness?.toFixed(1);
  }

  return stats;
}

function calculateNP(powerValues) {
  if (powerValues.length < 30) return 0;
  
  const windowSize = 30;
  const rollingAvg = [];
  
  for (let i = 0; i <= powerValues.length - windowSize; i++) {
    const window = powerValues.slice(i, i + windowSize);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    rollingAvg.push(avg);
  }
  
  const fourthPowers = rollingAvg.map(v => Math.pow(v, 4));
  const avgFourthPower = fourthPowers.reduce((a, b) => a + b, 0) / fourthPowers.length;
  return Math.round(Math.pow(avgFourthPower, 0.25));
}

function applySmoothing(data, windowSeconds) {
  if (windowSeconds === 0) return data;
  
  const windowSize = windowSeconds;
  const smoothed = [];
  
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    const validValues = window.filter(v => v !== null && v !== undefined);
    if (validValues.length > 0) {
      smoothed.push(validValues.reduce((a, b) => a + b, 0) / validValues.length);
    } else {
      smoothed.push(null);
    }
  }
  
  return smoothed;
}

function resetAllZooms() {
  Object.values(charts).forEach(chart => {
    if (chart.resetZoom) {
      chart.resetZoom();
    }
    if (chart.scales.x) {
      chart.scales.x.options.min = undefined;
      chart.scales.x.options.max = undefined;
    }
    if (chart.scales.y) {
      chart.scales.y.options.min = undefined;
      chart.scales.y.options.max = undefined;
    }
    chart.update();
  });
}

function renderStats(stats) {
  return renderStatsHtml(stats);
}

function renderStatsHtml(stats) {
  let html = '<div class="stats-grid">';
  
  if (stats.duration) {
    html += `<div class="stat-card"><div class="label">Duration</div><div class="value">${stats.duration}</div></div>`;
  }
  if (stats.totalDistance) {
    html += `<div class="stat-card"><div class="label">Distance (km)</div><div class="value">${stats.totalDistance}</div></div>`;
  }
  if (stats.avgSpeed) {
    html += `<div class="stat-card"><div class="label">Avg Speed (km/h)</div><div class="value">${stats.avgSpeed}</div></div>`;
  }
  if (stats.maxSpeed) {
    html += `<div class="stat-card"><div class="label">Max Speed (km/h)</div><div class="value">${stats.maxSpeed}</div></div>`;
  }
  if (stats.avgCadence) {
    html += `<div class="stat-card"><div class="label">Avg Cadence (rpm)</div><div class="value">${stats.avgCadence}</div></div>`;
  }
  if (stats.maxCadence) {
    html += `<div class="stat-card"><div class="label">Max Cadence (rpm)</div><div class="value">${stats.maxCadence}</div></div>`;
  }
  if (stats.avgHR) {
    html += `<div class="stat-card"><div class="label">Avg HR (bpm)</div><div class="value">${stats.avgHR}</div></div>`;
  }
  if (stats.maxHR) {
    html += `<div class="stat-card"><div class="label">Max HR (bpm)</div><div class="value">${stats.maxHR}</div></div>`;
  }
  if (stats.avgPower) {
    html += `<div class="stat-card"><div class="label">Avg Power (W)</div><div class="value">${stats.avgPower}</div></div>`;
  }
  if (stats.maxPower) {
    html += `<div class="stat-card"><div class="label">Max Power (W)</div><div class="value">${stats.maxPower}</div></div>`;
  }
  if (stats.normalizedPower) {
    html += `<div class="stat-card"><div class="label">Normalized Power (W)</div><div class="value">${stats.normalizedPower}</div></div>`;
  }
  if (stats.leftRightBalance) {
    html += `<div class="stat-card"><div class="label">L/R Balance (L%)</div><div class="value">${stats.leftRightBalance}</div></div>`;
  }
  if (stats.leftPedalSmoothness) {
    html += `<div class="stat-card"><div class="label">L Pedal Smoothness (%)</div><div class="value">${stats.leftPedalSmoothness}</div></div>`;
  }
  if (stats.rightPedalSmoothness) {
    html += `<div class="stat-card"><div class="label">R Pedal Smoothness (%)</div><div class="value">${stats.rightPedalSmoothness}</div></div>`;
  }
  if (stats.leftTorqueEffectiveness) {
    html += `<div class="stat-card"><div class="label">L Torque Effectiveness (%)</div><div class="value">${stats.leftTorqueEffectiveness}</div></div>`;
  }
  if (stats.rightTorqueEffectiveness) {
    html += `<div class="stat-card"><div class="label">R Torque Effectiveness (%)</div><div class="value">${stats.rightTorqueEffectiveness}</div></div>`;
  }
  
  html += '</div>';
  return html;
}

function createChartConfig(datasets, options = {}) {
  const textColor = isDarkMode ? '#888' : '#666';
  const gridColor = isDarkMode ? '#333' : '#cccccc';
  const { yMin, yMax, isScatter } = options;
  
  let chartDatasets, chartType, chartData, interactionMode, xTicks;
  
  if (isScatter) {
    chartType = 'scatter';
    chartDatasets = datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: ds.color + '60',
      borderColor: ds.color,
      pointRadius: 2,
      pointHoverRadius: 4
    }));
    chartData = { datasets: chartDatasets };
    interactionMode = 'nearest';
    xTicks = { color: textColor, maxTicksLimit: 10 };
  } else if (datasets.some(ds => ds.label?.includes('Smoothness'))) {
    chartType = 'scatter';
    chartDatasets = datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: ds.color + '60',
      borderColor: ds.color,
      pointRadius: 2,
      pointHoverRadius: 4
    }));
    chartData = { labels: labels.filter((_, i) => datasets[0]?.data[i]?.x !== undefined), datasets: chartDatasets };
    interactionMode = 'nearest';
    xTicks = { color: textColor, maxTicksLimit: 10 };
  } else {
    chartType = 'line';
    chartDatasets = datasets.map(ds => {
      const isAvg = ds.label.includes('Avg');
      let group = null;
      if (ds.label.includes('Speed')) group = 'speed';
      else if (ds.label.includes('Cadence')) group = 'cadence';
      else if (ds.label.includes('HR')) group = 'heartRate';
      else if (ds.label.includes('Power')) group = ds.label.includes('L Power') ? 'leftPower' : ds.label.includes('R Power') ? 'rightPower' : 'power';
      else if (ds.label.includes('Smooth')) group = ds.label.includes('L') ? 'leftPedalSmooth' : 'rightPedalSmooth';
      return {
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.color + (isDarkMode ? '20' : '30'),
        borderWidth: isAvg ? 1 : 1.5,
        pointRadius: 0,
        tension: 0.1,
        fill: false,
        yAxisID: ds.yAxis === 'y2' ? 'y2' : 'y',
        _group: group
      };
    });
    chartData = { labels, datasets: chartDatasets };
    interactionMode = 'index';
    xTicks = { color: textColor, maxTicksLimit: 10 };
  }

  const yScale = {
    display: true,
    position: 'left',
    ticks: { color: textColor },
    grid: { color: gridColor, borderColor: gridColor },
    title: { display: true, color: textColor }
  };
  
  const y2Scale = {
    display: datasets.some(ds => ds.yAxis === 'y2'),
    position: 'right',
    ticks: { color: '#f97316' },
    grid: { drawOnChartArea: false },
    title: { display: true, color: textColor }
  };

  if (yMin !== undefined) yScale.min = yMin;
  if (yMax !== undefined) yScale.max = yMax;

  const config = {
    type: chartType,
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: isScatter ? 1 : 1.25,
      animation: false,
      interaction: {
        intersect: false,
        mode: interactionMode
      },
      plugins: {
        legend: { 
          display: datasets.filter(ds => !ds.label.includes('Avg')).length > 1,
          labels: { color: textColor, filter: item => !item.text.includes('Avg') },
          onClick: (e, legendItem, legend) => {
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            const clickedDataset = ci.data.datasets[index];
            const group = clickedDataset._group;
            const newHidden = ci.getDatasetMeta(index).hidden === null ? !clickedDataset.hidden : null;
            ci.data.datasets.forEach((ds, i) => {
              if (ds._group === group) {
                ci.getDatasetMeta(i).hidden = newHidden;
              }
            });
            ci.update();
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: isScatter ? 'xy' : 'x',
            onZoom: ({ chart }) => { syncChartsZoom(chart); }
          },
          pan: {
            enabled: true,
            mode: isScatter ? 'xy' : 'x',
            onPan: ({ chart }) => { syncChartsZoom(chart); }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: tooltipItem => !tooltipItem.dataset.label.includes('Avg ')
        }
      },
      onClick: (e, elements, chart) => {
        if (elements.length === 0) {
          chart.options.plugins.tooltip.enabled = false;
          chart.update('none');
          setTimeout(() => {
            chart.options.plugins.tooltip.enabled = true;
          }, 300);
        }
      },
      onHover: (e, elements, chart) => {
        chart.canvas.style.cursor = elements.length === 0 ? 'default' : 'crosshair';
      },
      scales: {
        x: {
          display: true,
          ticks: { ...xTicks, color: textColor },
          grid: { color: gridColor, borderColor: gridColor },
          title: { display: true, text: isScatter ? 'Power (W)' : '', color: textColor }
        },
        y: { ...yScale, title: { display: true, text: isScatter ? 'L Balance / Smoothness (%)' : '', color: textColor } },
        ...(y2Scale.display ? { y2: y2Scale } : {})
      }
    }
  };
  
  return config;
}

let syncTimeout = null;
function syncChartsZoom(sourceChart) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    const sourceScale = sourceChart.scales.x;
    if (!sourceScale || sourceScale.min === undefined) return;
    
    const min = sourceScale.min;
    const max = sourceScale.max;
    
    Object.entries(charts).forEach(([key, chart]) => {
      if (chart !== sourceChart && chart.scales.x && !key.startsWith('scatter')) {
        chart.scales.x.options.min = min;
        chart.scales.x.options.max = max;
        chart.update('none');
      }
    });
  }, 10);
}

async function processFiles(files) {
  clearError();
  
  if (files.length === 0) return;
  
  for (const file of files) {
    const tabId = 'tab-' + (++tabCounter);
    
    try {
      const fitDataParsed = await parseFitFile(file);
      const fitData = extractRecordData(fitDataParsed);
      const sessionData = extractSessionData(fitDataParsed, fitData);
      const stats = calculateStats(fitData, sessionData);
      
      fileTabs[tabId] = { name: file.name, fitData, stats };
      window.fitData = fitData;
      
      createTab(tabId, file.name);
      renderTabContent(tabId, fitData, stats);
      switchToTab(tabId);
      
    } catch (err) {
      showError(`Error parsing ${file.name}: ${err.message}`);
      console.error(err);
    }
  }
}

function createTab(tabId, fileName) {
  const tabsContainer = document.getElementById('tabsContainer');
  const tabsList = document.getElementById('tabsList');
  
  tabsContainer.style.display = 'block';
  
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.tabId = tabId;
  tab.innerHTML = `<span>${fileName}</span><span class="tab-close" data-close="${tabId}">×</span>`;
  tab.onclick = (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchToTab(tabId);
    }
  };
  tabsList.appendChild(tab);
  
  const closeBtn = tab.querySelector('.tab-close');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTab(tabId);
  };
  
  const tabContent = document.createElement('div');
  tabContent.id = tabId;
  tabContent.className = 'tab-content';
  document.getElementById('tabContents').appendChild(tabContent);
}

function switchToTab(tabId) {
  activeTabId = tabId;
  
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.classList.add('active');
  
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  
  const tabData = fileTabs[tabId];
  if (tabData && tabData.fitData) {
    setTimeout(() => {
      renderMapForTab(tabId, tabData.fitData);
    }, 10);
  }
}

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let touchStartElement = null;

document.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
  touchStartElement = e.target;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  touchEndX = e.changedTouches[0].screenX;
  touchEndY = e.changedTouches[0].screenY;
  if (touchStartElement) {
    const el = touchStartElement;
    if (el.classList?.contains('leaflet-container') || el.classList?.contains('leaflet-tile') || 
        el.closest('.leaflet-container') || el.closest('canvas') || el.closest('.chart-wrapper')) {
      return;
    }
  }
  handleSwipe();
}, { passive: true });

function handleSwipe() {
  const swipeThreshold = 50;
  const diffX = touchStartX - touchEndX;
  const diffY = Math.abs(touchStartY - touchEndY);
  
  if (typeof diffX !== 'number' || typeof diffY !== 'number') return;
  if (Math.abs(diffX) < swipeThreshold) return;
  if (diffY > 30) return;
  
  const tabs = Object.keys(fileTabs);
  if (tabs.length < 2) return;
  
  const currentIndex = tabs.indexOf(activeTabId);
  
  if (diffX > 0) {
    const nextIndex = Math.min(currentIndex + 1, tabs.length - 1);
    if (nextIndex !== currentIndex) {
      switchToTab(tabs[nextIndex]);
    }
  } else {
    const prevIndex = Math.max(currentIndex - 1, 0);
    if (prevIndex !== currentIndex) {
      switchToTab(tabs[prevIndex]);
    }
  }
}

function closeTab(tabId) {
  const tab = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const content = document.getElementById(tabId);
  
  if (tab) tab.remove();
  if (content) content.remove();
  
  delete fileTabs[tabId];
  
  if (activeTabId === tabId) {
    const remaining = Object.keys(fileTabs);
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      activeTabId = null;
      document.getElementById('tabsContainer').style.display = 'none';
    }
  }
}

function renderTabContent(tabId, fitData, stats) {
  const container = document.getElementById(tabId);
  
  const statsHtml = renderStatsHtml(stats);
  container.innerHTML = `
    <div class="tab-header-bar" style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; padding: 0.5rem; background: #0f3460; border-radius: 8px;">
      <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #00d9ff;">
        <input type="checkbox" id="toggle-stats-${tabId}" checked onchange="toggleSection('${tabId}', 'stats', this.checked)">
        <span>Stats</span>
      </label>
      <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #00d9ff;">
        <input type="checkbox" id="toggle-map-${tabId}" checked onchange="toggleSection('${tabId}', 'map', this.checked)">
        <span>Map</span>
      </label>
      <span style="color: #00d9ff;">Smoothing:</span>
      <select class="global-smoothing" data-tab="${tabId}" style="padding: 0.25rem 0.5rem; border-radius: 4px; background: #0f3460; color: #00d9ff; border: 1px solid #00d9ff; font-size: 0.875rem; cursor: pointer;">
        <option value="0" ${currentSmoothing === 0 ? 'selected' : ''}>Raw</option>
        <option value="3" ${currentSmoothing === 3 ? 'selected' : ''}>3s avg</option>
        <option value="10" ${currentSmoothing === 10 ? 'selected' : ''}>10s avg</option>
        <option value="30" ${currentSmoothing === 30 ? 'selected' : ''}>30s avg</option>
      </select>
    </div>
    <div id="statsContainer-${tabId}">${statsHtml}</div>
    <div id="mapContainer-${tabId}" style="margin-bottom: 1.5rem;">
      <div class="chart-wrapper" style="padding: 0.5rem;">
        <div id="map-${tabId}" style="height: 400px; border-radius: 8px;"></div>
      </div>
    </div>
    <div id="chartsContainer-${tabId}" class="charts-container"></div>
  `;
  
  renderMapForTab(tabId, fitData);
  renderChartsForTab(tabId, fitData);
  
  document.querySelector(`.global-smoothing[data-tab="${tabId}"]`)?.addEventListener('change', (e) => {
    currentSmoothing = parseInt(e.target.value);
    renderChartsForTab(tabId, fitData);
  });
  
  window.toggleSection = (tabId, section, visible) => {
    if (section === 'stats') {
      document.getElementById(`statsContainer-${tabId}`).style.display = visible ? 'block' : 'none';
    } else if (section === 'map') {
      document.getElementById(`mapContainer-${tabId}`).style.display = visible ? 'block' : 'none';
    }
  };
}

function renderMapForTab(tabId, data) {
  const mapContainer = document.getElementById(`mapContainer-${tabId}`);
  const mapElement = document.getElementById(`map-${tabId}`);
  
  if (!mapElement) return;
  
  const validCoords = [];
  for (let i = 0; i < data.gpsLat.length; i++) {
    if (data.gpsLat[i] !== null && data.gpsLong[i] !== null) {
      const lat = data.gpsLat[i];
      const lon = data.gpsLong[i];
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001) {
        validCoords.push([lat, lon]);
      }
    }
  }
  
  if (validCoords.length < 10) {
    mapContainer.style.display = 'none';
    return;
  }

  mapContainer.style.display = 'block';
  
  if (window.mapInstance) {
    window.mapInstance.remove();
    window.mapInstance = null;
  }
  
  const newMapElement = mapElement.cloneNode(false);
  mapElement.parentNode.replaceChild(newMapElement, mapElement);
  
  const renderKey = Date.now() + '-' + Math.random();
  newMapElement.dataset.renderKey = renderKey;
  
  setTimeout(() => {
    if (newMapElement.dataset.renderKey !== renderKey) return;
    
    const map = L.map(newMapElement, { zoomControl: true });
    window.mapInstance = map;
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    
    const polyline = L.polyline(validCoords, { color: '#ff8c00', weight: 4 }).addTo(map);
    
    const startIcon = L.divIcon({
      className: 'marker-start',
      html: '<div style="background:#22c55e;width:16px;height:16px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;">▶</div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    L.marker(validCoords[0], { icon: startIcon }).addTo(map).bindPopup('Start');
    
    const finishIcon = L.divIcon({
      className: 'marker-finish',
      html: '<div style="background:#333;width:16px;height:16px;border-radius:2px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;">🏁</div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    L.marker(validCoords[validCoords.length - 1], { icon: finishIcon }).addTo(map).bindPopup('Finish');
    
    let totalDist = 0;
    const kmMarkers = [];
    for (let i = 1; i < validCoords.length; i++) {
      const d = map.distance(validCoords[i - 1], validCoords[i]) / 1000;
      totalDist += d;
      const km = Math.round(totalDist);
      const prevKm = kmMarkers.length > 0 ? kmMarkers[kmMarkers.length - 1].km : 0;
      if (km > prevKm) {
        let interval = 1;
        if (totalDist > 20) interval = 5;
        if (totalDist > 50) interval = 10;
        if (km % interval === 0) {
          kmMarkers.push({ km, coords: validCoords[i] });
        }
      }
    }
    
    kmMarkers.forEach(m => {
      const markerIcon = L.divIcon({
        className: 'km-marker',
        html: `<div style="background:#ff8c00;color:#fff;font-size:10px;font-weight:bold;padding:2px 4px;border-radius:4px;border:1px solid #fff;">${m.km}km</div>`,
        iconSize: [30, 16],
        iconAnchor: [15, 8]
      });
      L.marker(m.coords, { icon: markerIcon }).addTo(map);
    });
    
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
  }, 50);
}

function renderChartsForTab(tabId, data) {
  const container = document.getElementById(`chartsContainer-${tabId}`);
  if (!container) {
    return;
  }
  Object.keys(charts).forEach(k => {
    if (k.startsWith(tabId)) {
      charts[k].destroy();
      delete charts[k];
    }
  });
  
  labels = data.timestamps.map(t => {
    if (!(t instanceof Date) || isNaN(t)) return '';
    const elapsed = (t - data.timestamps[0]) / 1000;
    return formatDuration(elapsed);
  });
  
  const smoothLabel = currentSmoothing === 0 ? 'Raw' : currentSmoothing + 's avg';
  
  const chartGroups = [
    { id: 'speed', datasets: [] },
    { id: 'cadence', datasets: [] },
    { id: 'hr', datasets: [] },
    { id: 'power', datasets: [] },
    { id: 'balance', datasets: [] },
    { id: 'pedal', datasets: [] },
    { id: 'running', datasets: [] },
    { id: 'scatter', datasets: [], isScatter: true },
    { id: 'smoothness', datasets: [], isScatter: true }
  ];
  
  if (data.speed.some(v => v !== null && v !== undefined)) {
    const avgSpeed = data.speed.filter(v => v != null).reduce((a, b) => a + b, 0) / data.speed.filter(v => v != null).length;
    chartGroups[0].datasets.push({ label: 'Speed (km/h)', data: data.speed, color: '#00d9ff' });
    if (avgSpeed) chartGroups[0].datasets.push({ label: 'Avg Speed', data: data.speed.map(() => avgSpeed), color: '#66e5ff' });
  }
  if (data.altitude.some(v => v !== null && v !== undefined)) {
    chartGroups[0].datasets.push({ label: 'Elevation (m)', data: data.altitude, color: '#f97316', yAxis: 'y2' });
  }
  
  if (data.cadence.some(v => v !== null && v !== undefined)) {
    const avgCadence = data.cadence.filter(v => v != null).reduce((a, b) => a + b, 0) / data.cadence.filter(v => v != null).length;
    chartGroups[1].datasets.push({ label: 'Cadence (rpm)', data: data.cadence, color: '#00ff88' });
    if (avgCadence) chartGroups[1].datasets.push({ label: 'Avg Cadence', data: data.cadence.map(() => avgCadence), color: '#88ffbb' });
  }
  
  if (data.strideLength?.some(v => v !== null && v !== undefined)) {
    const avgStride = data.strideLength.filter(v => v != null).reduce((a, b) => a + b, 0) / data.strideLength.filter(v => v != null).length;
    chartGroups[1].datasets.push({ label: 'Stride Length (m)', data: data.strideLength, color: '#22c55e', yAxis: 'y2' });
    if (avgStride) chartGroups[1].datasets.push({ label: 'Avg Stride', data: data.strideLength.map(() => avgStride), color: '#66d98e', yAxis: 'y2' });
  }
  
  if (data.heartRate.some(v => v !== null && v !== undefined)) {
    const avgHR = data.heartRate.filter(v => v != null).reduce((a, b) => a + b, 0) / data.heartRate.filter(v => v != null).length;
    chartGroups[2].datasets.push({ label: 'Heart Rate (bpm)', data: data.heartRate, color: '#ff6b6b' });
    if (avgHR) chartGroups[2].datasets.push({ label: 'Avg HR', data: data.heartRate.map(() => avgHR), color: '#ff9999' });
  }
  
  const smoothedPower = applySmoothing(data.power, currentSmoothing);
  if (data.power.some(v => v !== null && v !== undefined)) {
    const avgPower = data.power.filter(v => v != null).reduce((a, b) => a + b, 0) / data.power.filter(v => v != null).length;
    const powerLabel = `Power (W) - ${smoothLabel}`;
    chartGroups[3].datasets.push({ label: powerLabel, data: smoothedPower, color: '#ffd93d' });
    if (avgPower) chartGroups[3].datasets.push({ label: 'Avg Power', data: data.power.map(() => avgPower), color: '#ffe066' });
  }
  
  const smoothedLeftPower = applySmoothing(data.leftPower, currentSmoothing);
  const smoothedRightPower = applySmoothing(data.rightPower, currentSmoothing);
  if (data.leftPower.some(v => v !== null && v !== undefined)) {
    const avgLP = data.leftPower.filter(v => v != null).reduce((a, b) => a + b, 0) / data.leftPower.filter(v => v != null).length;
    chartGroups[3].datasets.push({ label: `L Power - ${smoothLabel}`, data: smoothedLeftPower, color: '#06b6d4' });
    if (avgLP) chartGroups[3].datasets.push({ label: 'Avg L Power', data: data.leftPower.map(() => avgLP), color: '#33b5d4' });
  }
  if (data.rightPower.some(v => v !== null && v !== undefined)) {
    const avgRP = data.rightPower.filter(v => v != null).reduce((a, b) => a + b, 0) / data.rightPower.filter(v => v != null).length;
    chartGroups[3].datasets.push({ label: `R Power - ${smoothLabel}`, data: smoothedRightPower, color: '#f43f5e' });
    if (avgRP) chartGroups[3].datasets.push({ label: 'Avg R Power', data: data.rightPower.map(() => avgRP), color: '#f4718f' });
  }
  
  const smoothedBalance = applySmoothing(data.leftRightBalance, currentSmoothing);
  if (data.leftRightBalance.some(v => v !== null && v !== undefined)) {
    chartGroups[4].datasets.push({ label: `L Balance (%) - ${smoothLabel}`, data: smoothedBalance, color: '#a855f7' });
  }
  
  const smoothedLTe = applySmoothing(data.leftTorqueEffectiveness, currentSmoothing);
  const smoothedRTe = applySmoothing(data.rightTorqueEffectiveness, currentSmoothing);
  const smoothedLPs = applySmoothing(data.leftPedalSmoothness, currentSmoothing);
  const smoothedRPs = applySmoothing(data.rightPedalSmoothness, currentSmoothing);
  
  const hasTorqueData = data.leftTorqueEffectiveness.some(v => v != null && v !== 0) ||
                        data.rightTorqueEffectiveness.some(v => v != null && v !== 0) ||
                        data.leftPedalSmoothness.some(v => v != null && v !== 0) ||
                        data.rightPedalSmoothness.some(v => v != null && v !== 0);
  
  if (hasTorqueData) {
    if (data.leftTorqueEffectiveness.some(v => v != null && v !== 0)) {
      chartGroups[5].datasets.push({ label: `L Torque Eff (%) - ${smoothLabel}`, data: smoothedLTe, color: '#06b6d4' });
    }
    if (data.rightTorqueEffectiveness.some(v => v != null && v !== 0)) {
      chartGroups[5].datasets.push({ label: `R Torque Eff (%) - ${smoothLabel}`, data: smoothedRTe, color: '#f43f5e' });
    }
    if (data.leftPedalSmoothness.some(v => v != null && v !== 0)) {
      const avgLPs = data.leftPedalSmoothness.filter(v => v != null && v !== 0).reduce((a, b) => a + b, 0) / data.leftPedalSmoothness.filter(v => v != null && v !== 0).length;
      chartGroups[5].datasets.push({ label: `L Pedal Smooth (%) - ${smoothLabel}`, data: smoothedLPs, color: '#22c55e' });
      if (avgLPs) chartGroups[5].datasets.push({ label: 'Avg L Smooth', data: data.leftPedalSmoothness.map(() => avgLPs), color: '#66d98e' });
    }
    if (data.rightPedalSmoothness.some(v => v != null && v !== 0)) {
      const avgRPs = data.rightPedalSmoothness.filter(v => v != null && v !== 0).reduce((a, b) => a + b, 0) / data.rightPedalSmoothness.filter(v => v != null && v !== 0).length;
      chartGroups[5].datasets.push({ label: `R Pedal Smooth (%) - ${smoothLabel}`, data: smoothedRPs, color: '#eab308' });
      if (avgRPs) chartGroups[5].datasets.push({ label: 'Avg R Smooth', data: data.rightPedalSmoothness.map(() => avgRPs), color: '#f5d742' });
    }
  }
  
  const scatterData = [];
  for (let i = 0; i < data.power.length; i++) {
    if (data.power[i] !== null && data.leftRightBalance[i] !== null) {
      scatterData.push({ x: data.power[i], y: data.leftRightBalance[i] });
    }
  }
  if (scatterData.length > 0) {
    chartGroups[6].datasets.push({ label: 'L/R vs Power', data: scatterData, color: '#a855f7' });
  }
  
  const lSmoothnessData = [];
  const rSmoothnessData = [];
  for (let i = 0; i < data.power.length; i++) {
    if (data.leftPedalSmoothness[i] !== null && data.power[i] !== null) {
      lSmoothnessData.push({ x: data.power[i], y: data.leftPedalSmoothness[i] });
    }
    if (data.rightPedalSmoothness[i] !== null && data.power[i] !== null) {
      rSmoothnessData.push({ x: data.power[i], y: data.rightPedalSmoothness[i] });
    }
  }
  if (lSmoothnessData.length > 0) {
    chartGroups[7].datasets.push({ label: 'L Smoothness', data: lSmoothnessData, color: '#22c55e' });
  }
  if (rSmoothnessData.length > 0) {
    chartGroups[7].datasets.push({ label: 'R Smoothness', data: rSmoothnessData, color: '#eab308' });
  }
  
  if (data.verticalRatio?.some(v => v !== null && v !== undefined) || 
      data.verticalOscillation?.some(v => v !== null && v !== undefined)) {
    const smoothedVR = applySmoothing(data.verticalRatio, currentSmoothing);
    if (data.verticalRatio?.some(v => v !== null && v !== undefined)) {
      chartGroups[6].datasets.push({ label: `Vertical Ratio (%) - ${smoothLabel}`, data: smoothedVR, color: '#22c55e' });
    }
    if (data.verticalOscillation?.some(v => v !== null && v !== undefined)) {
      const smoothedVO = applySmoothing(data.verticalOscillation, currentSmoothing).map(v => v !== null ? v / 10 : null);
      chartGroups[6].datasets.push({ label: `Vertical Oscillation (cm) - ${smoothLabel}`, data: smoothedVO, color: '#06b6d4', yAxis: 'y2' });
    }
  }
  
  const visibleGroups = chartGroups.filter(g => g.datasets.length > 0);
  
  let chartIndex = 0;
  visibleGroups.forEach((group, gi) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const toggleId = `toggle-${tabId}-${gi}`;
    const headerHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <input type="checkbox" id="${toggleId}" checked onchange="toggleChartGroup('${tabId}', ${gi}, this.checked)">
          <label for="${toggleId}" style="margin: 0; cursor: pointer;">${group.datasets[0]?.label?.split(' - ')[0] || group.datasets[0]?.label?.split(' ')[0] || 'Chart'}</label>
        </div>
        <button class="reset-zoom" onclick="resetZoomForTab('${tabId}')">Reset Zoom</button>
      </div>
    `;
    
    wrapper.innerHTML = headerHtml + `<div id="chart-group-${tabId}-${gi}"><canvas id="chart-${tabId}-${chartIndex}"></canvas></div>`;
    container.appendChild(wrapper);
    
    const chartOptions = {};
    if (group.isScatter) {
      chartOptions.yMin = -100;
      chartOptions.yMax = 100;
      chartOptions.isScatter = true;
    } else {
      const mainDs = group.datasets.find(ds => !ds.label.includes('Avg'));
      if (mainDs?.label?.includes('Balance')) {
        chartOptions.yMin = -100;
        chartOptions.yMax = 100;
      } else if (mainDs?.label?.includes('Torque') || mainDs?.label?.includes('Smooth')) {
        chartOptions.yMin = 0;
        chartOptions.yMax = 100;
      }
    }
    
    const ctx = document.getElementById(`chart-${tabId}-${chartIndex}`).getContext('2d');
    charts[`${tabId}-chart-${chartIndex}`] = new Chart(ctx, createChartConfig(group.datasets, chartOptions));
    chartIndex++;
  });
  
  window.resetZoomForTab = (tabId) => {
    Object.entries(charts).forEach(([key, chart]) => {
      if (key.startsWith(tabId)) {
        chart.resetZoom();
        if (chart.scales.x) {
          chart.scales.x.options.min = undefined;
          chart.scales.x.options.max = undefined;
        }
        if (chart.scales.y) {
          chart.scales.y.options.min = undefined;
          chart.scales.y.options.max = undefined;
        }
        chart.update();
      }
    });
  };
  
  window.toggleChartGroup = (tabId, gi, visible) => {
    const groupEl = document.getElementById(`chart-group-${tabId}-${gi}`);
    if (groupEl) {
      groupEl.style.display = visible ? 'block' : 'none';
    }
  };
}

function extractSessionData(data, fitData) {
  let session = null;
  
  if (data.activity?.sessions?.length > 0) {
    session = data.activity.sessions[0];
  } else if (data.sessions?.length > 0) {
    session = data.sessions[0];
  }
  
  let leftBalance = null;
  if (fitData && fitData.leftRightBalance) {
    const validBalances = fitData.leftRightBalance.filter(v => v !== null && v !== undefined && !isNaN(v) && v > -100 && v < 100);
    if (validBalances.length > 0) {
      const avgBalance = validBalances.reduce((a, b) => a + b, 0) / validBalances.length;
      leftBalance = 50 + avgBalance;
    }
  }
  
  return {
    leftRightBalance: leftBalance,
    leftPedalSmoothness: session?.avg_left_pedal_smoothness ?? session?.left_pedal_smoothness,
    rightPedalSmoothness: session?.avg_right_pedal_smoothness ?? session?.right_pedal_smoothness,
    leftTorqueEffectiveness: session?.avg_left_torque_effectiveness ?? session?.left_torque_effectiveness,
    rightTorqueEffectiveness: session?.avg_right_torque_effectiveness ?? session?.right_torque_effectiveness
  };
}

function setupFileHandling() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const themeToggle = document.getElementById('themeToggle');
  
  themeToggle?.addEventListener('click', () => {
    toggleDarkMode();
    themeToggle.textContent = isDarkMode ? '🌙' : '☀️';
  });
  if (themeToggle) {
    themeToggle.textContent = isDarkMode ? '🌙' : '☀️';
  }
  
  uploadArea.addEventListener('click', () => fileInput.click());
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  
  uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = await handleInputFiles(Array.from(e.dataTransfer.files));
    if (files.length > 0) {
      processFiles(files);
      updateFileList(files);
    }
  });
  
  fileInput.addEventListener('change', async (e) => {
    const files = await handleInputFiles(Array.from(e.target.files));
    if (files.length > 0) {
      processFiles(files);
      updateFileList(files);
    }
  });
}

async function handleInputFiles(files) {
  const fitFiles = [];
  let zipErrors = [];
  for (const file of files) {
    if (file.name.endsWith('.fit') || file.name.endsWith('.FIT')) {
      fitFiles.push(file);
    } else if (file.name.endsWith('.zip') || file.name.endsWith('.ZIP')) {
      try {
        const zip = await JSZip.loadAsync(file);
        const fitEntries = Object.keys(zip.files).filter(name => 
          name.endsWith('.fit') || name.endsWith('.FIT')
        );
        if (fitEntries.length > 0) {
          const fitName = fitEntries.sort()[0];
          const fitBlob = await zip.files[fitName].async('blob');
          fitFiles.push(new File([fitBlob], fitName.split('/').pop(), { type: 'application/octet-stream' }));
        } else {
          zipErrors.push(file.name);
        }
      } catch (err) {
        console.error('Error extracting zip:', err);
        showError(`Error reading zip file: ${file.name}`);
      }
    }
  }
  if (zipErrors.length > 0) {
    showError(`No .FIT files found in: ${zipErrors.join(', ')}`);
  }
  return fitFiles;
}

function updateFileList(files) {
  const fileList = document.getElementById('fileList');
  fileList.innerHTML = files.map(f => 
    `<div class="file-item"><span class="name">${f.name}</span></div>`
  ).join('');
}

async function renderMap(data) {
  const mapContainer = document.getElementById('mapContainer');
  const mapElement = document.getElementById('map');
  
  const validCoords = [];
  for (let i = 0; i < data.gpsLat.length; i++) {
    if (data.gpsLat[i] !== null && data.gpsLong[i] !== null) {
      const lat = data.gpsLat[i];
      const lon = data.gpsLong[i];
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001) {
        validCoords.push([lat, lon]);
      }
    }
  }
  
  if (validCoords.length < 10) {
    mapContainer.style.display = 'none';
    return;
  }
  
  mapContainer.style.display = 'block';
  
  if (window.fitMap) {
    window.fitMap.remove();
  }
  
  const L = await import('leaflet');
  
  window.fitMap = L.map('map').setView(validCoords[Math.floor(validCoords.length / 2)], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(window.fitMap);
  
  const polyline = L.polyline(validCoords, {
    color: '#ff6600',
    weight: 4,
    opacity: 0.9
  }).addTo(window.fitMap);
  
  function haversineDistance(coord1, coord2) {
    const R = 6371;
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
    const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  let totalDistance = 0;
  const kmMarkers = [];
  let nextKm = 1;
  
  for (let i = 1; i < validCoords.length; i++) {
    totalDistance += haversineDistance(validCoords[i-1], validCoords[i]);
    while (totalDistance >= nextKm) {
      const ratio = (nextKm - (totalDistance - haversineDistance(validCoords[i-1], validCoords[i]))) / haversineDistance(validCoords[i-1], validCoords[i]);
      const lat = validCoords[i-1][0] + (validCoords[i][0] - validCoords[i-1][0]) * ratio;
      const lon = validCoords[i-1][1] + (validCoords[i][1] - validCoords[i-1][1]) * ratio;
      kmMarkers.push({ lat, lon, km: nextKm });
      nextKm++;
    }
  }
  
  kmMarkers.forEach(marker => {
    L.circleMarker([marker.lat, marker.lon], {
      radius: 5,
      color: '#ff6600',
      fillColor: '#ffcc00',
      fillOpacity: 1,
      weight: 2
    }).bindPopup(`${marker.km} km`).addTo(window.fitMap);
  });
  
  const startIcon = L.divIcon({
    className: 'custom-marker',
    html: '<div style="background: #00ff00; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  
  const endIcon = L.divIcon({
    className: 'custom-marker',
    html: '<div style="background: #ff0000; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  
  L.marker(validCoords[0], { icon: startIcon }).bindPopup('Start').addTo(window.fitMap);
  L.marker(validCoords[validCoords.length - 1], { icon: endIcon }).bindPopup('End').addTo(window.fitMap);
  
  window.fitMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

setupFileHandling();
