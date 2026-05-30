'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function InventoryDashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [shortageItems, setShortageItems] = useState<any[]>([]);
  
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [viewMode, setViewMode] = useState<'active' | 'all'>('active');
  const [inputValues, setInputValues] = useState<{ [key: number]: string }>({});

  // 💡 삭제 모드 토글 상태
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  // 재고 변경 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [targetStock, setTargetStock] = useState<number>(0);
  const [modalMode, setModalMode] = useState<'relative' | 'absolute'>('relative');
  const [relativeChange, setRelativeChange] = useState<number>(0);

  // 새 품목 등록 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('의약품');
  const [newStock, setNewStock] = useState('0');
  const [newSafetyStock, setNewSafetyStock] = useState('50');
  const [newExpireDateInput, setNewExpireDateInput] = useState('');

  // 품목명 수정 모달 상태
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');

  // 💡 시효기간 추가(분할 등록) 모달 상태
  const [isExpireModalOpen, setIsExpireModalOpen] = useState(false);
  const [expireDate, setExpireDate] = useState('');
  const [expireStock, setExpireStock] = useState('0');

  const fetchMainItems = async (search: string, mode: 'active' | 'all') => {
    let query = supabase.from('items').select('*').order('id', { ascending: false });
    if (mode === 'active') query = query.eq('is_active', true);
    if (search.trim() !== '') query = query.ilike('name', `%${search}%`);
    else if (mode === 'all') query = query.limit(150);
    const { data } = await query;
    if (data) setItems(data);
  };

  const fetchShortageItems = async () => {
    const { data } = await supabase
      .from('items')
      .select('*')
      .eq('is_active', true)
      .lt('current_stock', 50)
      .order('id', { ascending: false });
    if (data) setShortageItems(data);
  };

  useEffect(() => {
    fetchMainItems(leftSearch, viewMode);
    fetchShortageItems();
    const channel = supabase.channel('realtime inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
        fetchMainItems(leftSearch, viewMode);
        fetchShortageItems(); 
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [viewMode]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => { fetchMainItems(leftSearch, viewMode); }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [leftSearch]);

  const toggleActiveStatus = async (item: any) => {
    const newStatus = !item.is_active;
    const { error } = await supabase.from('items').update({ is_active: newStatus }).eq('id', item.id);
    if (error) alert("상태 변경에 실패했습니다: " + error.message);
  };

  const handleInputChange = (itemId: number, value: string) => {
    setInputValues(prev => ({ ...prev, [itemId]: value }));
  };

  const handleRelativeClick = (item: any, change: number) => {
    if (item.current_stock + change < 0) { alert("재고는 0개 미만으로 내려갈 수 없습니다."); return; }
    setSelectedItem(item); setTargetStock(item.current_stock + change); setRelativeChange(change); setModalMode('relative'); setIsModalOpen(true);
  };

  const handleAbsoluteClick = (item: any) => {
    const value = inputValues[item.id];
    if (!value || value.trim() === '') { alert("변경할 숫자를 입력해주세요."); return; }
    const parsedStock = parseInt(value, 10);
    if (isNaN(parsedStock) || parsedStock < 0) { alert("0 이상의 숫자만 입력 가능합니다."); return; }
    setSelectedItem(item); setTargetStock(parsedStock); setModalMode('absolute'); setIsModalOpen(true);
  };

  const handleConfirmChange = async () => {
    if (!selectedItem) return;
    const { error } = await supabase.from('items').update({ current_stock: targetStock }).eq('id', selectedItem.id);
    if (error) alert("재고 수정 실패: " + error.message);
    else { setInputValues(prev => ({ ...prev, [selectedItem.id]: '' })); setIsModalOpen(false); setSelectedItem(null); }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const { error } = await supabase.from('items').insert([{ 
      name: newName, 
      category: newCategory, 
      current_stock: parseInt(newStock, 10) || 0, 
      safety_stock: parseInt(newSafetyStock, 10) || 50, 
      expiration_date: newExpireDateInput.trim(),
      is_active: true 
    }]);
    if (error) alert("등록 실패: " + error.message);
    else { setIsAddModalOpen(false); setNewName(''); setNewStock('0'); setNewExpireDateInput(''); }
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !editName.trim()) return;
    const { error } = await supabase.from('items').update({ name: editName.trim() }).eq('id', selectedItem.id);
    if (error) alert("품목명 수정에 실패했습니다: " + error.message);
    else { setIsEditModalOpen(false); setSelectedItem(null); setEditName(''); }
  };

  // 💡 시효기간 분할 등록 승인 (동일 이름, 새로운 시효기간 데이터 행 생성)
  const handleAddExpiration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !expireDate.trim()) { alert("시효기간을 입력해주세요."); return; }

    const { error } = await supabase.from('items').insert([{
      name: selectedItem.name,
      category: selectedItem.category || '의약품',
      current_stock: parseInt(expireStock, 10) || 0,
      safety_stock: selectedItem.safety_stock || 50,
      expiration_date: expireDate.trim(),
      is_active: true
    }]);

    if (error) {
      alert("시효기간 품목 추가 실패: " + error.message);
    } else {
      setIsExpireModalOpen(false);
      setSelectedItem(null);
      setExpireDate('');
      setExpireStock('0');
    }
  };

  // 💡 데이터베이스에서 품목 영구 삭제 처리 함수
  const handleDeleteItem = async (item: any) => {
    if (!confirm(`[경고] 명단에서 "${item.name}" (시효기간: ${item.expiration_date || '없음'}) 품목을 영구적으로 삭제하시겠습니까?`)) return;

    const { error } = await supabase.from('items').delete().eq('id', item.id);
    if (error) alert("삭제 실패: " + error.message);
  };

  const filteredShortageItems = shortageItems.filter(item => item.name.toLowerCase().includes(rightSearch.toLowerCase()));

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#0B0F19] text-gray-200 font-sans overflow-hidden">
      
      {/* 🟢 좌측 메인 영역 */}
      <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
          <h1 className="text-xl lg:text-2xl font-bold text-white tracking-tight">전체 재고 관리 대시보드</h1>
          
          {/* 상단 액션 버튼 그룹 */}
          <div className="flex space-x-2">
            <button onClick={() => setIsAddModalOpen(true)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 font-bold rounded-lg text-white shadow-lg text-xs lg:text-sm whitespace-nowrap">+ 새 품목 등록</button>
            {/* 💡 삭제 모드 전환 스위치 추가 */}
            <button 
              onClick={() => setIsDeleteMode(!isDeleteMode)} 
              className={`px-3 py-2 font-bold rounded-lg text-white text-xs lg:text-sm whitespace-nowrap transition-colors ${isDeleteMode ? 'bg-red-600 hover:bg-red-500 ring-2 ring-red-400' : 'bg-gray-800 hover:bg-gray-700'}`}
            >
              {isDeleteMode ? '🚫 삭제 모드 종료' : '🗑️ 기존 품목 삭제'}
            </button>
          </div>
        </div>

        <div className="flex space-x-2 mb-4 lg:mb-6 bg-[#111827] p-1 rounded-lg w-fit border border-gray-800">
          <button onClick={() => setViewMode('active')} className={`px-3 py-1.5 lg:px-4 lg:py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'active' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
            📋 취급 품목만 보기 (기본)
          </button>
          <button onClick={() => setViewMode('all')} className={`px-3 py-1.5 lg:px-4 lg:py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'all' ? 'bg-gray-800 text-white shadow border border-gray-700' : 'text-gray-400 hover:text-white'}`}>
            🌐 전체 창고 보기
          </button>
        </div>
        
        <div className="mb-4 lg:mb-6">
          <input 
            type="text" placeholder={viewMode === 'active' ? "현재 취급 품목 실시간 검색..." : "식약처 전체 실시간 검색..."}
            className="w-full max-w-md p-2.5 lg:p-3 rounded-lg bg-[#111827] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors shadow-inner text-sm"
            value={leftSearch} onChange={(e) => setLeftSearch(e.target.value)}
          />
        </div>

        <div className="bg-[#111827] rounded-xl shadow-2xl border border-gray-800/80 p-3 lg:p-5 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                {isDeleteMode && <th className="pb-3 font-semibold text-center w-12 text-red-400">삭제</th>}
                <th className="pb-3 font-semibold w-20">고유 번호</th>
                <th className="pb-3 font-semibold w-1/3">품목명</th>
                {/* 💡 시효기간 테이블 열 신설 */}
                <th className="pb-3 font-semibold w-32 text-center text-yellow-400">시효기간</th>
                <th className="pb-3 font-semibold text-center w-24">취급 상태</th>
                <th className="pb-3 font-semibold text-center w-80">재고 제어 (단품 / 대량)</th>
                <th className="pb-3 font-semibold text-right pr-6 w-24">현재고</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-all duration-150 group ${!item.is_active && 'opacity-50'}`}>
                  
                  {/* 💡 삭제 모드일 때만 쓰레기통 버튼이 노출됨 */}
                  {isDeleteMode && (
                    <td className="py-4 text-center">
                      <button onClick={() => handleDeleteItem(item)} className="p-1.5 rounded bg-red-950/40 hover:bg-red-600 text-red-400 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.34 12m-4.72 0L9 9m11.42 3.31a48.667 48.667 0 0 0-7.36-1.91M3.14 12.29a48.008 48.008 0 0 1 7.36-1.91M19.485 12c.262 2.384.444 4.8.54 7.232M4.515 12c-.263 2.384-.444 4.8-.54 7.232M8.25 4.5h7.5M4.56 8.25h14.88" /></svg>
                      </button>
                    </td>
                  )}

                  <td className="py-4 text-gray-500 text-sm">#{item.id}</td>
                  
                  <td className="py-4 font-medium text-white">
                    <div className="flex items-center">
                      <span className="truncate max-w-xs">{item.name}</span>
                      <button 
                        onClick={() => { setSelectedItem(item); setEditName(item.name); setIsEditModalOpen(true); }}
                        className="ml-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-gray-400 hover:text-blue-400 transition-all p-1 rounded hover:bg-gray-800 bg-gray-800/50 lg:bg-transparent" title="품목명 수정"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>
                      </button>
                    </div>
                  </td>
                  
                  {/* 💡 시효기간 표시 및 분할 추가 액션 탑재 */}
                  <td className="py-4 text-center">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="text-sm font-semibold text-gray-300 bg-gray-900/60 px-2 py-0.5 rounded border border-gray-800">{item.expiration_date || '미기입'}</span>
                      {item.is_active && (
                        <button 
                          onClick={() => { setSelectedItem(item); setIsExpireModalOpen(true); }}
                          className="text-[10px] bg-yellow-600/20 hover:bg-yellow-600 text-yellow-400 hover:text-white px-1.5 py-0.5 rounded border border-yellow-600/30 transition-all font-bold"
                        >
                          + 시효 추가
                        </button>
                      )}
                    </div>
                  </td>
                  
                  <td className="py-4 text-center">
                    <button onClick={() => toggleActiveStatus(item)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${item.is_active ? 'bg-blue-600' : 'bg-gray-700'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>

                  <td className="py-4 text-center">
                    <div className="inline-flex items-center space-x-3 bg-[#0B0F19]/40 px-3 py-1.5 rounded-lg border border-gray-800">
                      <div className="inline-flex rounded-md shadow-sm bg-[#0B0F19] p-0.5 border border-gray-700">
                        <button onClick={() => handleRelativeClick(item, -1)} disabled={!item.is_active} className="px-3 py-1 text-sm font-bold text-red-400 hover:bg-gray-800 rounded disabled:opacity-30">-</button>
                        <span className="px-1 text-gray-700">|</span>
                        <button onClick={() => handleRelativeClick(item, 1)} disabled={!item.is_active} className="px-3 py-1 text-sm font-bold text-green-400 hover:bg-gray-800 rounded disabled:opacity-30">+</button>
                      </div>
                      <span className="text-gray-700 font-light">/</span>
                      <div className="flex items-center space-x-1.5">
                        <input type="number" min="0" placeholder="대량" disabled={!item.is_active} className="w-16 p-1.5 text-center rounded bg-[#0B0F19] border border-gray-700 text-white text-xs" value={inputValues[item.id] || ''} onChange={(e) => handleInputChange(item.id, e.target.value)} />
                        <button onClick={() => handleAbsoluteClick(item)} disabled={!item.is_active} className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-xs font-bold rounded text-white transition-colors disabled:opacity-30">적용</button>
                      </div>
                    </div>
                  </td>

                  <td className={`py-4 font-bold text-right pr-6 text-lg ${item.current_stock < 50 ? 'text-red-400' : 'text-emerald-400'}`}>{item.current_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🔴 우측 하단: 긴급 보충 피드 */}
      <div className="w-full lg:w-96 h-[40vh] lg:h-auto bg-[#111827] border-t lg:border-t-0 lg:border-l border-gray-800/80 p-4 lg:p-6 flex flex-col shadow-2xl shrink-0 z-10">
        <div className="flex items-center mb-3 border-b border-gray-800 pb-3">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse mr-2.5"></div>
          <h2 className="text-lg lg:text-xl font-bold text-red-400 tracking-tight">긴급 보충 피드</h2>
        </div>
        <div className="mb-3"><input type="text" placeholder="부족 품목 중 검색..." className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-xs" value={rightSearch} onChange={(e) => setRightSearch(e.target.value)} /></div>
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
          {filteredShortageItems.map(item => (
            <div key={item.id} className="bg-red-950/20 border border-red-900/50 p-3 rounded-xl flex flex-col">
              <span className="font-semibold text-red-200 text-sm mb-0.5">{item.name}</span>
              <span className="text-[10px] text-yellow-500 mb-1">시효기간: {item.expiration_date || '미기입'}</span>
              <div className="flex justify-between items-center"><span className="text-xs text-gray-500">#{item.id}</span><span className="text-xs text-gray-400">재고: <span className="text-red-400 font-black">{item.current_stock}개</span></span></div>
            </div>
          ))}
        </div>
      </div>

      {/* 💡 팝업 1: 시효기간 추가 (동일 약품 기한 분할 등록) 모달창 */}
      {isExpireModalOpen && selectedItem && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
          <form onSubmit={handleAddExpiration} className="bg-[#111827] border border-gray-800 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-yellow-400 pb-2 border-b border-gray-800">⏳ 시효기간별 품목 분할 등록</h3>
            <p className="text-xs text-gray-400">선택 약품: <span className="text-white font-bold">{selectedItem.name}</span></p>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">새로운 시효기간 입력</label>
              <input type="text" required placeholder="예: 2026-12-31" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">해당 시효 품목의 초기 재고</label>
              <input type="number" min="0" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm text-center" value={expireStock} onChange={(e) => setExpireStock(e.target.value)} />
            </div>
            <div className="flex space-x-2 justify-end pt-2 border-t border-gray-800">
              <button type="button" onClick={() => { setIsExpireModalOpen(false); setSelectedItem(null); }} className="px-3 py-1.5 bg-gray-800 text-xs rounded">취소</button>
              <button type="submit" className="px-3 py-1.5 bg-yellow-600 text-xs text-white rounded font-bold">분리 등록 완료</button>
            </div>
          </form>
        </div>
      )}

      {/* 팝업 2: 수동 새 품목 등록 모달 */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
          <form onSubmit={handleAddItem} className="bg-[#111827] border border-gray-800 rounded-2xl p-5 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-white pb-3 border-b border-gray-800">📦 시스템 새 품목 등록</h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1">품목명</label>
              <input type="text" required placeholder="예: 아목시실린 500mg" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">초기 시효기간 (선택)</label>
                <input type="text" placeholder="예: 2027-05-20" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm" value={newExpireDateInput} onChange={(e) => setNewExpireDateInput(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">분류</label>
                <select className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}><option value="의약품">의약품</option><option value="의료기재">의료기재</option></select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">초기 수량</label>
                <input type="number" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm text-center" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">안전재고</label>
                <input type="number" className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm text-center" value={newSafetyStock} onChange={(e) => setNewSafetyStock(e.target.value)} />
              </div>
            </div>
            <div className="flex space-x-2 justify-end pt-2 border-t border-gray-800">
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 bg-gray-800 text-xs text-white rounded">취소</button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-xs text-white rounded">등록 완료</button>
            </div>
          </form>
        </div>
      )}

      {/* 팝업 3: 명칭 변경 */}
      {isEditModalOpen && selectedItem && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-md">
          <form onSubmit={handleUpdateName} className="bg-[#111827] border border-gray-800 rounded-2xl p-5 max-w-sm w-full space-y-4">
            <h3 className="text-xs font-bold text-white pb-2 border-b border-gray-800">✏️ 품목 명칭 변경</h3>
            <input type="text" required className="w-full p-2 rounded bg-[#0B0F19] border border-gray-700 text-white text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <div className="flex space-x-2 justify-end"><button type="button" onClick={() => setIsEditModalOpen(false)} className="px-3 py-1.5 bg-gray-800 text-xs">취소</button><button type="submit" className="px-3 py-1.5 bg-blue-600 text-xs text-white">수정 완료</button></div>
          </form>
        </div>
      )}

      {/* 팝업 4: 재고 수정 최종 컨펌 */}
      {isModalOpen && selectedItem && (
         <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 max-w-sm w-full">
            <h3 className="text-sm font-bold text-white mb-2">⚠️ 재고 변경 최종 승인</h3>
            <p className="text-xs text-gray-400">[{selectedItem.name}] 기한:({selectedItem.expiration_date || '없음'}) 수량을 {targetStock}개로 업데이트합니다.</p>
            <div className="flex space-x-2 justify-end mt-4"><button onClick={() => setIsModalOpen(false)} className="px-3 py-1.5 bg-gray-800 text-xs text-white">취소</button><button onClick={handleConfirmChange} className="px-3 py-1.5 bg-blue-600 text-xs text-white">변경 승인</button></div>
          </div>
        </div>
      )}
    </div>
  );
}