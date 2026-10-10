# 任務 3 參考答案（用兩段半圓繞柱子）
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 柱子在前方 250 公分；以柱子為圓心、半徑 2.5 公尺的半圓繞過去
tello.curve_xyz_speed(250, 250, 0, 500, 0, 0, 50)    # 從左邊繞到柱子後面
tello.rotate_clockwise(180)                           # 掉頭
tello.curve_xyz_speed(250, 250, 0, 500, 0, 0, 50)    # 從另一邊繞回起點
tello.land()
