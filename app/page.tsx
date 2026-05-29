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

  // 💡 품목명 수정 모달 상태 추가
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');

  const fetchMainItems = async (search: string, mode: 'active' | 'all') => {
    let query = supabase.from('items').select('*').order('id', { ascending: false });
    
    if (mode === 'active') {
      query = query.eq('is_active', true);
    }

    if (search.trim() !== '') {
      query = query.ilike('name', `%${search}%`);
    } else if (mode === 'all') {
      query = query.limit(150);
    }

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
    const delayDebounceFn = setTimeout(() => {
      fetchMainItems(leftSearch, viewMode);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [leftSearch]);

  const toggleActiveStatus = async (item: any) => {
    const newStatus = !item.is_active;
    const { error } = await supabase
      .from('items')
      .update({ is_active: newStatus })
      .eq('id', item.id);
      
    if (error) alert("상태 변경에 실패했습니다: " + error.message);
  };

  const handleInputChange = (itemId: number, value: string) => {
    setInputValues(prev => ({ ...prev, [itemId]: value }));
  };

  const handleRelativeClick = (item: any, change: number) => {
    if (item.current_stock + change < 0) {
      alert("재고는 0개 미만으로 내려갈 수 없습니다.");
      return;
    }
    setSelectedItem(item);
    setTargetStock(item.current_stock + change);
    setRelativeChange(change);
    setModalMode('relative');
    setIsModalOpen(true);
  };

  const handleAbsoluteClick = (item: any) => {
    const value = inputValues[item.id];
    if (!value || value.trim() === '') {
      alert("변경할 숫자를 입력해주세요.");
      return;
    }
    const parsedStock = parseInt(value, 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      alert("0 이상의 숫자만 입력 가능합니다.");
      return;
    }
    setSelectedItem(item);
    setTargetStock(parsedStock);
    setModalMode('absolute');
    setIsModalOpen(true);
  };

  const handleConfirmChange = async () => {
    if (!selectedItem) return;
    const { error } = await supabase
      .from('items')
      .update({ current_stock: targetStock })
      .eq('id', selectedItem.id);

    if (error) alert("재고 수정 실패: " + error.message);
    else { setInputValues(prev => ({ ...prev, [selectedItem.id]: '' })); setIsModalOpen(false); setSelectedItem(null); }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const { error } = await supabase.from('items').insert([
      { name: newName, category: newCategory, current_stock: parseInt(newStock, 10) || 0, safety_stock: parseInt(newSafetyStock, 10) || 50, is_active: true }
    ]);
    if (error) alert("등록 실패: " + error.message);
    else { setIsAddModalOpen(false); setNewName(''); setNewStock('0'); }
  };

  // 💡 품목명 원격 수정 데이터베이스 처리 함수
  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !editName.trim()) return;

    const { error } = await supabase
      .from('items')
      .update({ name: editName.trim() })
      .eq('id', selectedItem.id);

    if (error) {
      alert("품목명 수정에 실패했습니다: " + error.message);
    } else {
      setIsEditModalOpen(false);
      setSelectedItem(null);
      setEditName('');
    }
  };

  const filteredShortageItems = shortageItems.filter(item =>
    item.name.toLowerCase().includes(rightSearch.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#0B0F19] text-gray-200 font-sans">
      
      {/* 🟢 좌측 메인 영역 */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-white tracking-tight">전체 재고 관리 대시보드</h1>
          <button onClick={() => setIsAddModalOpen(true)} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 font-bold rounded-lg text-white shadow-lg text-sm">+ 새 품목 등록</button>
        </div>

        <div className="flex space-x-2 mb-6 bg-[#111827] p-1 rounded-lg w-fit border border-gray-800">
          <button onClick={() => setViewMode('active')} className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'active' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
            📋 취급 품목만 보기 (기본)
          </button>
          <button onClick={() => setViewMode('all')} className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'all' ? 'bg-gray-800 text-white shadow border border-gray-700' : 'text-gray-400 hover:text-white'}`}>
            🌐 전체 창고(식약처) 보기
          </button>
        </div>
        
        <div className="mb-6">
          <input 
            type="text" 
            placeholder={viewMode === 'active' ? "현재 취급 품목 중에서 실시간 검색..." : "식약처 창고 전체에서 실시간 검색..."}
            className="w-full max-w-md p-3 rounded-lg bg-[#111827] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors shadow-inner text-sm"
            value={leftSearch}
            onChange={(e) => setLeftSearch(e.target.value)}
          />
        </div>

        <div className="bg-[#111827] rounded-xl shadow-2xl border border-gray-800/80 p-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                <th className="pb-3 font-semibold">고유 번호</th>
                <th className="pb-3 font-semibold w-1/3">품목명</th>
                <th className="pb-3 font-semibold text-center w-24">취급 상태</th>
                <th className="pb-3 font-semibold text-center w-80">재고 제어 (단품 / 대량)</th>
                <th className="pb-3 font-semibold text-right pr-6 w-24">현재고</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-all duration-150 group ${!item.is_active && 'opacity-50'}`}>
                  <td className="py-4 text-gray-500 text-sm">#{item.id}</td>
                  
                  {/* 💡 품목명 가독성 최적화 및 호버링 편집 스위치 부착 */}
                  <td className="py-4 font-medium text-white">
                    <div className="flex items-center">
                      <span className="truncate max-w-xs">{item.name}</span>
                      <button 
                        onClick={() => { setSelectedItem(item); setEditName(item.name); setIsEditModalOpen(true); }}
                        className="ml-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-blue-400 transition-all duration-150 p-1 rounded hover:bg-gray-800"
                        title="품목명 수정"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  
                  <td className="py-4 text-center">
                    <button 
                      onClick={() => toggleActiveStatus(item)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${item.is_active ? 'bg-blue-600' : 'bg-gray-700'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>

                  <td className="py-4 text-center">
                    <div className="inline-flex items-center space-x-3 bg-[#0B0F19]/40 px-3 py-1.5 rounded-lg border border-gray-800">
                      <div className="inline-flex rounded-md shadow-sm bg-[#0B0F19] p-0.5 border border-gray-700">
                        <button onClick={() => handleRelativeClick(item, -1)} disabled={!item.is_active} className="px-2.5 py-1 text-sm font-bold text-red-400 hover:bg-gray-800 rounded disabled:opacity-30">-</button>
                        <span className="px-1 text-gray-700">|</span>
                        <button onClick={() => handleRelativeClick(item, 1)} disabled={!item.is_active} className="px-2.5 py-1 text-sm font-bold text-green-400 hover:bg-gray-800 rounded disabled:opacity-30">+</button>
                      </div>
                      <span className="text-gray-700 font-light">/</span>
                      <div className="flex items-center space-x-1.5">
                        <input 
                          type="number" min="0" placeholder="대량" disabled={!item.is_active}
                          className="w-16 p-1 text-center rounded bg-[#0B0F19] border border-gray-700 text-white focus:outline-none focus:border-blue-500 disabled:opacity-30 text-xs"
                          value={inputValues[item.id] || ''}
                          onChange={(e) => handleInputChange(item.id, e.target.value)}
                        />
                        <button onClick={() => handleAbsoluteClick(item)} disabled={!item.is_active} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-xs font-bold rounded text-white transition-colors disabled:opacity-30">적용</button>
                      </div>
                    </div>
                  </td>

                  <td className={`py-4 font-bold text-right pr-6 text-lg ${item.current_stock < 50 ? 'text-red-400' : 'text-emerald-400'}`}>{item.current_stock}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-gray-500">조건에 부합하는 품목이 존재하지 않습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🔴 우측 긴급 보충 피드 */}
      <div className="w-96 bg-[#111827] border-l border-gray-800/80 p-6 flex flex-col shadow-2xl z-10">
        <div className="flex items-center mb-4 border-b border-gray-800 pb-4">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse mr-3"></div>
          <h2 className="text-xl font-bold text-red-400 tracking-tight">긴급 보충 피드</h2>
        </div>

        <div className="mb-4">
          <input 
            type="text" 
            placeholder="부족 품목 중 검색..." 
            className="w-full p-2 rounded-lg bg-[#0B0F19] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors text-xs shadow-inner"
            value={rightSearch}
            onChange={(e) => setRightSearch(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
          {filteredShortageItems.length === 0 ? (
            <div className="text-center text-gray-500 mt-10 text-sm">부족한 품목이 없거나 검색 결과가 없습니다.</div>
          ) : (
            filteredShortageItems.map(item => (
              <div key={item.id} className="bg-red-950/20 border border-red-900/50 p-4 rounded-xl flex flex-col shadow-md">
                <span className="font-semibold text-red-200 text-sm mb-1">{item.name}</span>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-500">#{item.id}</span>
                  <span className="text-xs text-gray-400">재고: <span className="text-red-400 font-black text-sm">{item.current_stock}개</span></span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 💡 팝업 1: 품목 명칭 변경 전용 실시간 모달창 */}
      {isEditModalOpen && selectedItem && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 backdrop-blur-md">
          <form onSubmit={handleUpdateName} className="bg-[#111827] border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white pb-3 border-b border-gray-800 flex items-center">✏️ 품목 명칭 변경</h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">선택한 품목 고유코드: #{selectedItem.id}</label>
              <input 
                type="text" required className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
                value={editName} onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex space-x-3 justify-end pt-2 border-t border-gray-800">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-800 text-xs font-medium hover:bg-gray-700">취소</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500">수정 완료</button>
            </div>
          </form>
        </div>
      )}

      {/* 팝업 2: 수동 등록 모달 */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 backdrop-blur-md">
          <form onSubmit={handleAddItem} className="bg-[#111827] border border-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-white pb-3 border-b border-gray-800">📦 시스템 새 품목 등록</h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">품목명</label>
              <input type="text" required placeholder="예: 아목시실린 500mg" className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">분류</label>
                <select className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-sm" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}><option value="의약품">의약품</option><option value="의료기재">의료기재</option></select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">초기고</label>
                <input type="number" className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-sm text-center" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">안전재고</label>
                <input type="number" className="w-full p-2.5 rounded-lg bg-[#0B0F19] border border-gray-700 text-white text-sm text-center" value={newSafetyStock} onChange={(e) => setNewSafetyStock(e.target.value)} />
              </div>
            </div>
            <div className="flex space-x-3 justify-end pt-2 border-t border-gray-800">
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-800 text-sm">취소</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-sm text-white">등록 완료</button>
            </div>
          </form>
        </div>
      )}

      {/* 팝업 3: 수량 변경 승인 모달 */}
      {isModalOpen && selectedItem && (
         <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-3">⚠️ 재고 변경 확인 승인</h3>
            <p className="text-sm text-gray-400 mb-4">
              <span className="text-white">[{selectedItem.name}]</span> 재고를 <span className="text-yellow-400">{selectedItem.current_stock}개</span>에서 <span className="text-yellow-400">{targetStock}개</span>로 변경합니다.
            </p>
            <div className="flex space-x-3 justify-end mt-5">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-800 text-sm">취소</button>
              <button onClick={handleConfirmChange} className="px-4 py-2 rounded-lg bg-blue-600 text-sm text-white">변경 승인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}