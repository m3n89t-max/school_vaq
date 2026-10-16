import { insertMetric } from './db.js';
import { getCachedPLCData, convertPLCToMetricData } from './plc-client.js';

// 조리실 지표 8개 (PLC에서 제공)
const KITCHEN_METRICS = [
  'pm10',
  'pm25',
  'co2',
  'voc',
  'hcho',
  'co',
  'temp',
  'hum'
];

export async function generateSensorData(): Promise<any> {
  const data: any = {
    kitchen: {},
    washing: {},
    fans: {
      kitchen: {
        supply: { running: true, speed: 75 },
        exhaust: { running: true, speed: 80 }
      },
      washing: {
        supply: { running: true, speed: 70 },
        exhaust: { running: true, speed: 75 }
      }
    },
    fridge: {
      fridge1: { temp: 2.5, status: 'good' },
      fridge2: { temp: 3.0, status: 'good' },
      freezer1: { temp: -18.0, status: 'good' },
      freezer2: { temp: -19.0, status: 'good' }
    }
  };

  // PLC 데이터 가져오기 (실제 데이터만 사용)
  const plcData = getCachedPLCData();
  
  if (plcData === null) {
    console.warn('⚠️ PLC 연결 안 됨 - 데이터 없음');
    // PLC 연결 안 되면 빈 데이터 반환
    data.kitchen = {
      pm10: 0,
      pm25: 0,
      co2: 0,
      voc: 0,
      formaldehyde: 0,
      co: 0,
      temperature: 0,
      humidity: 0,
    };
    data.washing = {
      pm10: 0,
      pm25: 0,
      co2: 0,
      voc: 0,
      formaldehyde: 0,
      co: 0,
      temperature: 0,
      humidity: 0,
    };
    return data;
  }

  // PLC에서 실제 데이터 사용 (조리실)
  if (plcData.data.kitchen) {
    const kitchenData = convertPLCToMetricData(plcData.data.kitchen);
  data.kitchen = kitchenData;
  
  // 조리실 데이터 DB에 저장
  for (const metric of KITCHEN_METRICS) {
    let value = 0;
    if (metric === 'temp') value = kitchenData.temperature;
    else if (metric === 'hum') value = kitchenData.humidity;
    else if (metric === 'hcho') value = kitchenData.formaldehyde;
    else value = kitchenData[metric];
    
    await insertMetric('kitchen', metric, value);
  }
  } else {
    data.kitchen = {
      pm10: 0,
      pm25: 0,
      co2: 0,
      voc: 0,
      formaldehyde: 0,
      co: 0,
      temperature: 0,
      humidity: 0,
    };
  }

  // PLC에서 실제 데이터 사용 (세척실)
  if (plcData.data.washing) {
    const washingData = convertPLCToMetricData(plcData.data.washing);
    data.washing = washingData;
    
    // 세척실 데이터 DB에 저장
    for (const metric of KITCHEN_METRICS) {
      let value = 0;
      if (metric === 'temp') value = washingData.temperature;
      else if (metric === 'hum') value = washingData.humidity;
      else if (metric === 'hcho') value = washingData.formaldehyde;
      else value = washingData[metric];
      
      await insertMetric('washing', metric, value);
    }
  } else {
  data.washing = {
    pm10: 0,
    pm25: 0,
    co2: 0,
    voc: 0,
    formaldehyde: 0,
    co: 0,
    temperature: 0,
    humidity: 0,
  };
  }

  return data;
}

