# 任務 2 參考答案
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()           # 起飛後約 80 公分

tello.move_up(40)         # 升到 120 公分（第 1 個圈的高度）
tello.move_forward(250)   # 穿過第 1 個圈（前方 1.5 公尺）
tello.move_up(80)         # 升到 200 公分（第 2、3 個圈的高度）
tello.move_forward(200)   # 穿過第 2 個圈（前方 3.5 公尺），停在前方 4.5 公尺
tello.move_left(200)      # 往左穿過第 3 個圈（左邊 1.5 公尺）
tello.land()
