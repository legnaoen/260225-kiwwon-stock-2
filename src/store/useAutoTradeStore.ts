import { create } from 'zustand';

export interface OrderInfo {
    order_no: string;
    stk_cd: string;
    stk_nm?: string;
    status: string;
    price: number;
    qty: number;
    remain_qty: number;
    time: string;
    type?: string;
    order_type?: string;
}

interface AutoTradeState {
    isRunning: boolean;
    setIsRunning: (status: boolean) => void;
    orders: OrderInfo[];
    setOrders: (orders: OrderInfo[]) => void;
    addOrUpdateOrder: (order: OrderInfo) => void;
}

export const useAutoTradeStore = create<AutoTradeState>((set) => ({
    isRunning: false,
    setIsRunning: (status) => set({ isRunning: status }),
    orders: [],
    setOrders: (orders) => set({ orders }),
    addOrUpdateOrder: (order) =>
        set((state) => {
            const idx = state.orders.findIndex((o) => o.order_no === order.order_no);
            if (idx >= 0) {
                const newOrders = [...state.orders];
                newOrders[idx] = order;
                return { orders: newOrders };
            }
            return { orders: [...state.orders, order] };
        }),
}));
