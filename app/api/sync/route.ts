import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// 💡 정부 서버와 우리 서버의 과부하를 막기 위한 쉼표(Sleep) 함수
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET() {
  try {
    const apiKey = 'cc00394f965565fe175b2849c1fea074db876e6d3dfffb5b5a63bf04c917f489';
    let allDrugs: any[] = [];
    let pageNo = 1;
    const numOfRows = 100; 
    const maxPages = 50; // 💡 4,750개 전량을 모두 긁어오기 위해 50페이지(최대 5,000개)로 확장

    console.log("🚀 [무제한 엔진] 식약처 4,750개 전량 동기화 시작...");

    while (pageNo <= maxPages) {
      const apiUrl = `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${apiKey}&pageNo=${pageNo}&numOfRows=${numOfRows}&type=json`;
      
      const res = await fetch(apiUrl);
      if (!res.ok) {
        console.error(`❌ ${pageNo}페이지 호출 실패 (HTTP 에러)`);
        break;
      }

      const text = await res.text();
      if (text.includes('Unauthorized') || text.includes('SERVICE_ERROR')) {
        console.error(`❌ ${pageNo}페이지에서 정부 인증 거부 또는 서비스 에러 발생`);
        break;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error(`❌ ${pageNo}페이지 JSON 파싱 실패`);
        break;
      }

      const drugs = data.body?.items;
      if (!drugs || drugs.length === 0) {
        console.log(`✨ 식약처 종단 도달. 수집을 종료합니다. (최종 페이지: ${pageNo - 1})`);
        break; 
      }

      allDrugs = [...allDrugs, ...drugs];
      console.log(`📦 [진행 상황] 현재까지 ${allDrugs.length}개 약품 수집 완료...`);
      
      pageNo++;
      
      // 💡 정부 서버 트래픽 차단 경고를 우회하기 위해 한 페이지 받을 때마다 0.2초씩 휴식
      await sleep(200);
    }

    if (allDrugs.length === 0) {
      return NextResponse.json({ success: false, message: '정부 서버에서 가져온 약품이 없습니다.' });
    }

    console.log(`💾 수집 완료! 총 ${allDrugs.length}개 데이터를 창고(Supabase)에 저장합니다...`);

    // 우리 DB 구조에 맞게 매핑
    const insertData = allDrugs.map((drug: any) => ({
      name: drug.itemName,
      category: '의약품',
      current_stock: 0,
      safety_stock: 10,
      is_active: false // 수천 개가 알림 패널을 마비시키지 않도록 초기 스위치는 OFF
    }));

    // 대량 삽입 시 데이터베이스 락 방지를 위해 200개씩 청크(Chunk) 분할 삽입
    const chunkSize = 200;
    for (let i = 0; i < insertData.length; i += chunkSize) {
      const chunk = insertData.slice(i, i + chunkSize);
      const { error } = await supabase.from('items').insert(chunk);
      if (error) {
        console.error(`❌ DB 저장 중 오류 발생:`, error.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `정부 데이터베이스에서 총 ${allDrugs.length}개의 의약품 전량을 성공적으로 동기화했습니다!`
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: '동기화 중 시스템 예외가 발생했습니다.' });
  }
}