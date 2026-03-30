import FitParser from 'fit-file-parser';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';

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

let fitData = null;
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
        console.log('Parsed FIT data structure:', JSON.stringify(data, null, 2).substring(0, 3000));
        resolve(data);
      }
    });
  });
}

function extractRecordData(data) {
  let records = [];
  
  console.log('Looking for records in:', Object.keys(data));
  
  if (data.records && data.records.length > 0) {
    console.log('Found records at top level');
    records = data.records;
  } else if (data.activity) {
    console.log('Looking in activity.sessions');
    if (data.activity.sessions) {
      for (const session of data.activity.sessions) {
        console.log('Session keys:', Object.keys(session));
        if (session.laps) {
          for (const lap of session.laps) {
            console.log('Lap keys:', Object.keys(lap));
            if (lap.records) {
              console.log('Found', lap.records.length, 'records in lap');
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
  
  console.log('Total extracted records:', records.length);
  
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
    gpsLat: [],
    gpsLong: []
  };

  console.log('Sample record keys:', Object.keys(records[0] || {}));
  console.log('Sample record:', records[0]);

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

  console.log('Extracted data points:', result.timestamps.length);
  console.log('Sample record:', records[0]);
  
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

function renderStats(stats, session) {
  const container = document.getElementById('statsContainer');
  
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
  container.innerHTML = html;
}

function createChartConfig(datasets, options = {}) {
  const textColor = isDarkMode ? '#888' : '#666';
  const gridColor = isDarkMode ? '#333' : '#ddd';
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
    xTicks = { color: textColor, autoSkip: true, maxTicksLimit: 10 };
  } else {
    chartType = 'line';
    chartDatasets = datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      borderColor: ds.color,
      backgroundColor: ds.color + (isDarkMode ? '20' : '30'),
      borderWidth: ds.label.includes('Avg') ? 1 : 1.5,
      pointRadius: 0,
      tension: 0.1,
      fill: false,
      yAxisID: ds.yAxis === 'y2' ? 'y2' : 'y'
    }));
    chartData = { labels, datasets: chartDatasets };
    interactionMode = 'index';
    xTicks = { color: textColor, maxTicksLimit: 10 };
  }

  const yScale = {
    display: true,
    position: 'left',
    ticks: { color: textColor },
    grid: { color: gridColor }
  };
  
  const y2Scale = {
    display: datasets.some(ds => ds.yAxis === 'y2'),
    position: 'right',
    ticks: { color: '#f97316' },
    grid: { drawOnChartArea: false }
  };
  
  if (yMin !== undefined) yScale.min = yMin;
  if (yMax !== undefined) yScale.max = yMax;
  if (yMin !== undefined && yMax !== undefined) {
    yScale.afterDataLimits = (scale) => {
      if (scale.min < yMin) scale.min = yMin;
      if (scale.max > yMax) scale.max = yMax;
    };
  }

  return {
    type: chartType,
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: isScatter ? 2 : 2.5,
      animation: false,
      interaction: {
        intersect: false,
        mode: interactionMode
      },
      plugins: {
        legend: { 
          display: datasets.length > 1,
          labels: { color: textColor },
          onClick: (e, legendItem, legend) => {
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            const meta = ci.getDatasetMeta(index);
            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
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
          intersect: false
        }
      },
      onClick: (e, elements) => {
        const chart = Chart.getChart(e.chart.canvas);
        if (chart) {
          chart.options.plugins.tooltip.enabled = false;
          chart.update('none');
          setTimeout(() => {
            chart.options.plugins.tooltip.enabled = true;
          }, 300);
        }
      },
      onHover: (e, elements, chart) => {
        if (elements.length === 0) {
          chart.canvas.style.cursor = 'default';
        } else {
          chart.canvas.style.cursor = 'crosshair';
        }
      },
      scales: {
        x: {
          display: true,
          ticks: xTicks,
          grid: { color: gridColor },
          title: {
            display: true,
            text: isScatter ? 'Power (W)' : '',
            color: textColor
          }
        },
        y: { ...yScale, title: { display: true, text: isScatter ? 'L Balance / Smoothness (%)' : '', color: textColor } },
        ...(y2Scale.display ? { y2: y2Scale } : {})
      }
    }
  };
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

function renderCharts(data) {
  const container = document.getElementById('chartsContainer');
  container.innerHTML = '';
  
  labels = fitData.timestamps.map(t => {
    if (!(t instanceof Date) || isNaN(t)) return '';
    const elapsed = (t - fitData.timestamps[0]) / 1000;
    return formatDuration(elapsed);
  });
  
  const smoothedPower = applySmoothing(data.power, currentSmoothing);
  const smoothedLeftPower = applySmoothing(data.leftPower, currentSmoothing);
  const smoothedRightPower = applySmoothing(data.rightPower, currentSmoothing);
  
  const smoothedBalance = applySmoothing(data.leftRightBalance, currentSmoothing);
  
  const smoothedLTe = applySmoothing(data.leftTorqueEffectiveness, currentSmoothing);
  const smoothedRTe = applySmoothing(data.rightTorqueEffectiveness, currentSmoothing);
  const smoothedLPs = applySmoothing(data.leftPedalSmoothness, currentSmoothing);
  const smoothedRPs = applySmoothing(data.rightPedalSmoothness, currentSmoothing);
  
  const chartGroups = [
    {
      id: 'speed-elevation',
      title: 'Speed & Elevation',
      visible: true,
      datasets: []
    },
    {
      id: 'cadence',
      title: 'Cadence',
      visible: true,
      datasets: []
    },
    {
      id: 'heartrate',
      title: 'Heart Rate',
      visible: true,
      datasets: []
    },
    {
      id: 'power',
      title: 'Power',
      visible: true,
      datasets: []
    },
    {
      id: 'balance',
      title: 'Balance',
      visible: true,
      datasets: []
    },
    {
      id: 'torque-smoothness',
      title: 'Torque Effectiveness & Pedal Smoothness',
      visible: true,
      datasets: []
    },
    {
      id: 'balance-vs-power',
      title: 'Balance vs Power',
      visible: true,
      isScatter: true,
      datasets: []
    },
    {
      id: 'smoothness-vs-power',
      title: 'Pedal Smoothness vs Power',
      visible: true,
      isScatter: true,
      datasets: []
    }
  ];
  
  if (data.speed.some(v => v !== null && v !== undefined)) {
    chartGroups[0].datasets.push({ label: 'Speed (km/h)', data: data.speed, color: '#00d9ff' });
    const avgSpeed = data.speed.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.speed.filter(v => v !== null && v !== undefined).length;
    if (avgSpeed) {
      chartGroups[0].datasets.push({ label: 'Avg Speed', data: data.speed.map(() => avgSpeed), color: '#66e5ff' });
    }
  }
  if (data.altitude.some(v => v !== null && v !== undefined)) {
    chartGroups[0].datasets.push({ label: 'Elevation (m)', data: data.altitude, color: '#f97316', yAxis: 'y2' });
  }
  
  if (data.cadence.some(v => v !== null && v !== undefined)) {
    chartGroups[1].datasets.push({ label: 'Cadence (rpm)', data: data.cadence, color: '#00ff88' });
    const avgCadence = data.cadence.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.cadence.filter(v => v !== null && v !== undefined).length;
    if (avgCadence) {
      chartGroups[1].datasets.push({ label: 'Avg Cadence', data: data.cadence.map(() => avgCadence), color: '#88ffbb' });
    }
  }
  
  if (data.heartRate.some(v => v !== null && v !== undefined)) {
    chartGroups[2].datasets.push({ label: 'Heart Rate (bpm)', data: data.heartRate, color: '#ff6b6b' });
    const avgHR = data.heartRate.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.heartRate.filter(v => v !== null && v !== undefined).length;
    if (avgHR) {
      chartGroups[2].datasets.push({ label: 'Avg HR', data: data.heartRate.map(() => avgHR), color: '#ff9999' });
    }
  }
  
  const smoothLabel = currentSmoothing === 0 ? 'Raw' : currentSmoothing + 's avg';
  const powerLabel = `Power (W) - ${smoothLabel}`;
  if (data.power.some(v => v !== null && v !== undefined)) {
    chartGroups[3].datasets.push({ label: powerLabel, data: smoothedPower, color: '#ffd93d' });
    const avgPower = data.power.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.power.filter(v => v !== null && v !== undefined).length;
    if (avgPower) {
      chartGroups[3].datasets.push({ label: 'Avg Power', data: data.power.map(() => avgPower), color: '#ffe066' });
    }
  }
  if (data.leftPower.some(v => v !== null && v !== undefined)) {
    chartGroups[3].datasets.push({ label: `L Power - ${smoothLabel}`, data: smoothedLeftPower, color: '#06b6d4' });
    const avgLP = data.leftPower.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.leftPower.filter(v => v !== null && v !== undefined).length;
    if (avgLP) {
      chartGroups[3].datasets.push({ label: 'Avg L Power', data: data.leftPower.map(() => avgLP), color: '#33b5d4' });
    }
  }
  if (data.rightPower.some(v => v !== null && v !== undefined)) {
    chartGroups[3].datasets.push({ label: `R Power - ${smoothLabel}`, data: smoothedRightPower, color: '#f43f5e' });
    const avgRP = data.rightPower.filter(v => v !== null && v !== undefined).reduce((a, b) => a + b, 0) / data.rightPower.filter(v => v !== null && v !== undefined).length;
    if (avgRP) {
      chartGroups[3].datasets.push({ label: 'Avg R Power', data: data.rightPower.map(() => avgRP), color: '#f4718f' });
    }
  }
  
  if (data.leftRightBalance.some(v => v !== null && v !== undefined)) {
    chartGroups[4].datasets.push({ label: `L Balance (%) - ${smoothLabel}`, data: smoothedBalance, color: '#a855f7' });
  }
  
  const hasTorqueData = data.leftTorqueEffectiveness.some(v => v !== null && v !== undefined && v !== 0) ||
                        data.rightTorqueEffectiveness.some(v => v !== null && v !== undefined && v !== 0) ||
                        data.leftPedalSmoothness.some(v => v !== null && v !== undefined && v !== 0) ||
                        data.rightPedalSmoothness.some(v => v !== null && v !== undefined && v !== 0);
  
  if (hasTorqueData) {
    if (data.leftTorqueEffectiveness.some(v => v !== null && v !== undefined && v !== 0)) {
      chartGroups[5].datasets.push({ label: `L Torque Eff (%) - ${smoothLabel}`, data: smoothedLTe, color: '#06b6d4' });
    }
    if (data.rightTorqueEffectiveness.some(v => v !== null && v !== undefined && v !== 0)) {
      chartGroups[5].datasets.push({ label: `R Torque Eff (%) - ${smoothLabel}`, data: smoothedRTe, color: '#f43f5e' });
    }
    if (data.leftPedalSmoothness.some(v => v !== null && v !== undefined && v !== 0)) {
      chartGroups[5].datasets.push({ label: `L Pedal Smooth (%) - ${smoothLabel}`, data: smoothedLPs, color: '#22c55e' });
      const avgLPs = data.leftPedalSmoothness.filter(v => v !== null && v !== undefined && v !== 0).reduce((a, b) => a + b, 0) / data.leftPedalSmoothness.filter(v => v !== null && v !== undefined && v !== 0).length;
      if (avgLPs) {
        chartGroups[5].datasets.push({ label: 'Avg L Smooth', data: data.leftPedalSmoothness.map(() => avgLPs), color: '#66d98e' });
      }
    }
    if (data.rightPedalSmoothness.some(v => v !== null && v !== undefined && v !== 0)) {
      chartGroups[5].datasets.push({ label: `R Pedal Smooth (%) - ${smoothLabel}`, data: smoothedRPs, color: '#eab308' });
      const avgRPs = data.rightPedalSmoothness.filter(v => v !== null && v !== undefined && v !== 0).reduce((a, b) => a + b, 0) / data.rightPedalSmoothness.filter(v => v !== null && v !== undefined && v !== 0).length;
      if (avgRPs) {
        chartGroups[5].datasets.push({ label: 'Avg R Smooth', data: data.rightPedalSmoothness.map(() => avgRPs), color: '#f5d742' });
      }
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
    if (data.power[i] !== null) {
      if (data.leftPedalSmoothness[i] !== null && data.leftPedalSmoothness[i] !== undefined) {
        lSmoothnessData.push({ x: data.power[i], y: data.leftPedalSmoothness[i] });
      }
      if (data.rightPedalSmoothness[i] !== null && data.rightPedalSmoothness[i] !== undefined) {
        rSmoothnessData.push({ x: data.power[i], y: data.rightPedalSmoothness[i] });
      }
    }
  }
  if (lSmoothnessData.length > 0 || rSmoothnessData.length > 0) {
    if (lSmoothnessData.length > 0) {
      chartGroups[7].datasets.push({ label: 'L Smoothness', data: lSmoothnessData, color: '#22c55e' });
    }
    if (rSmoothnessData.length > 0) {
      chartGroups[7].datasets.push({ label: 'R Smoothness', data: rSmoothnessData, color: '#eab308' });
    }
  }
  
  const visibleGroups = chartGroups.filter(g => g.datasets.length > 0);
  
  container.innerHTML = '';
  
  Object.values(charts).forEach(chart => chart.destroy());
  Object.keys(charts).forEach(k => delete charts[k]);

  if (visibleGroups.length === 0) {
    container.innerHTML += '<div class="no-data">No data to display</div>';
    return;
  }

  let chartIndex = 0;
  let currentChartKey = '';
  
  visibleGroups.forEach((group, gi) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    
    const toggleId = `toggle-${gi}`;
    const isSmoothable = ['power', 'balance', 'torque-smoothness'].includes(group.id);
    currentChartKey = group.isScatter ? `scatter-${chartIndex}` : `chart-${chartIndex}`;
    
    let headerHtml = `<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
      <h3 style="margin: 0; color: var(--accent-color, #00ff88); cursor: pointer;" onclick="document.getElementById('${toggleId}').click()">${group.title}</h3>
      <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
        <input type="checkbox" id="${toggleId}" ${group.visible ? 'checked' : ''} onchange="toggleChartGroup(${gi}, this.checked)">
        <span style="color: var(--text-secondary, #888); font-size: 0.85rem;">Show</span>
      </label>
    </div>`;
    
    let extraControls = '';
    if (isSmoothable) {
      extraControls = `
        <div class="smoothing-control" style="margin-bottom: 1rem;">
          <label>Smoothing:</label>
          <select class="chart-smoothing" data-group="${group.id}">
            <option value="0" ${currentSmoothing === 0 ? 'selected' : ''}>Raw</option>
            <option value="3" ${currentSmoothing === 3 ? 'selected' : ''}>3s</option>
            <option value="10" ${currentSmoothing === 10 ? 'selected' : ''}>10s</option>
            <option value="30" ${currentSmoothing === 30 ? 'selected' : ''}>30s</option>
          </select>
        </div>
      `;
    }
    
    wrapper.innerHTML = headerHtml + extraControls + `<div id="chart-group-${gi}" ${!group.visible ? 'style="display:none"' : ''}><canvas id="chart-${chartIndex}"></canvas></div>`;
    container.appendChild(wrapper);
    
    const chartOptions = {};
    if (group.id === 'balance') {
      chartOptions.yMin = -100;
      chartOptions.yMax = 100;
    }
    if (group.isScatter) {
      chartOptions.isScatter = true;
      if (group.id === 'balance-vs-power') {
        chartOptions.yMin = -100;
        chartOptions.yMax = 100;
      } else if (group.id === 'smoothness-vs-power') {
        chartOptions.yMin = 0;
        chartOptions.yMax = 100;
      }
    }
    
    const ctx = document.getElementById(`chart-${chartIndex}`).getContext('2d');
    charts[currentChartKey] = new Chart(ctx, createChartConfig(group.datasets, chartOptions));
    chartIndex++;
  });
  
  document.querySelectorAll('.chart-reset-zoom').forEach(btn => {
    btn.onclick = (e) => {
      const key = e.currentTarget.dataset.key;
      if (charts[key]) {
        charts[key].resetZoom();
        if (charts[key].scales.x) {
          charts[key].scales.x.options.min = undefined;
          charts[key].scales.x.options.max = undefined;
        }
        if (charts[key].scales.y) {
          charts[key].scales.y.options.min = undefined;
          charts[key].scales.y.options.max = undefined;
        }
        charts[key].update();
      }
    };
  });
  
  document.querySelectorAll('.chart-smoothing').forEach(select => {
    select.addEventListener('change', (e) => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      currentSmoothing = parseInt(e.target.value);
      renderCharts(data);
      window.scrollTo(0, scrollTop);
    });
  });
  
  window.toggleChartGroup = (gi, visible) => {
    const groupEl = document.getElementById(`chart-group-${gi}`);
    if (groupEl) {
      groupEl.style.display = visible ? 'block' : 'none';
    }
  };
}

async function processFiles(files) {
  clearError();
  
  if (files.length === 0) return;
  
  try {
    const fitDataParsed = await parseFitFile(files[0]);
    fitData = extractRecordData(fitDataParsed);
    const sessionData = extractSessionData(fitDataParsed, fitData);
    
    const stats = calculateStats(fitData, sessionData);
    
    renderStats(stats);
    renderCharts(fitData);
    renderMap(fitData);
    
  } catch (err) {
    showError(`Error parsing FIT file: ${err.message}`);
    console.error(err);
  }
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
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.fit'));
    if (files.length > 0) {
      processFiles(files);
      updateFileList(files);
    }
  });
  
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      processFiles(files);
      updateFileList(files);
    }
  });
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
